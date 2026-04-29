// /api/v1/name-lists — bulk name import (PR-5 commit 3/6).
//
// Two routes:
//   POST /preview   multipart/form-data (file) → {rows, totals, sha256, sourceFilename}
//   POST /          JSON body                  → {list, duplicate, totals,
//                                                  jobsCreated, jobsTotal, partial}
//
// Stateless preview: serverul NU persista nimic la /preview. Clientul afiseaza
// preview-ul, iar la /commit re-trimite items-ul; serverul re-deriva validation
// + dedup independent (defense-in-depth — clientul nu poate marca un rind
// 'rejected' ca 'ok' modificand JSON-ul).
//
// Auto-create jobs: cand body.autoCreateJobs=true, dupa createList serverul
// genereaza in tranzactie monitoring_jobs(kind='name_soap') pentru primele
// `maxJobs` items eligibile (validation IN ('ok','warn'), monitoring_job_id IS
// NULL). Cap-ul de 100 (default si max) tine tranzactia scurta — un user cu
// 1000 nume face 10 calluri secventiale, fiecare batch creeaza 100 joburi noi
// (replay-ul via sha256 returneaza lista existenta, iar getCommittableItems
// filtreaza items-le deja legate). UI-ul re-trimite pana cand partial=false.

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Context } from "hono";

import { getOwnerId } from "../middleware/owner.ts";
import { recordAudit } from "../db/auditRepository.ts";
import {
  createList,
  getCommittableItems,
  linkItemToJob,
} from "../db/nameListsRepository.ts";
import {
  createJob,
} from "../db/monitoringJobsRepository.ts";
import { getDb } from "../db/schema.ts";
import {
  CommitListBodySchema,
  MAX_JOBS_PER_COMMIT,
} from "../schemas/nameLists.ts";
import { AlertConfigSchema } from "../schemas/monitoring.ts";
import {
  parseNameList,
  validateRawItems,
  ParseError,
  MAX_FILE_BYTES,
} from "../services/nameListParser.ts";
import { fail, ok } from "../util/envelope.ts";

// Body limits — se mapeaza pe cap-urile parser-ului (10MB fisier brut) +
// margine pentru JSON (15MB cuprinde ~50000 rinduri × ~200 chars + overhead).
const PREVIEW_BODY_LIMIT = MAX_FILE_BYTES; // 10 MB hard
const COMMIT_BODY_LIMIT = 15 * 1024 * 1024;

const previewTooLarge = (c: Context) =>
  c.json(fail("payload_too_large", "Fisier prea mare (max 10MB)", c), 413);
const commitTooLarge = (c: Context) =>
  c.json(fail("payload_too_large", "Payload prea mare (max 15MB)", c), 413);

const limitPreviewBody = bodyLimit({
  maxSize: PREVIEW_BODY_LIMIT,
  onError: previewTooLarge,
});
const limitCommitBody = bodyLimit({
  maxSize: COMMIT_BODY_LIMIT,
  onError: commitTooLarge,
});

// Mapeaza ParseErrorCode → HTTP status. Mentinem stable codes ca UI-ul sa
// poata afisa toast-uri specifice ("fisier prea mare" vs "coloana lipsa").
function parseErrorStatus(code: ParseError["code"]): 400 | 413 | 422 {
  switch (code) {
    case "FILE_TOO_LARGE":
      return 413;
    case "TOO_MANY_ROWS":
    case "TOO_MANY_COLS":
    case "EMPTY_FILE":
    case "MISSING_NAME_COLUMN":
      return 422;
    case "PARSE_ERROR":
    default:
      return 400;
  }
}

// JSON body reader cu acelasi pattern ca readLimitedJsonBody din monitoring.ts
// (separat ca sa nu importam un helper privat din alt router). Bodylimit
// middleware-ul aplica deja cap-ul, dar verificam si content-length + UTF-8
// byte length ca defense-in-depth pentru request-uri chunked unde server-ul
// vede stream-ul abia dupa parsing.
async function readLimitedJsonBody(
  c: Context,
  limit: number,
  tooLargeFactory: (c: Context) => Response,
): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const contentLength = Number(c.req.header("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > limit) {
    return { ok: false, response: tooLargeFactory(c) };
  }

  let raw: string;
  try {
    raw = await c.req.text();
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    const message = err instanceof Error ? err.message : String(err);
    if (name === "BodyLimitError" || message.includes("Payload Too Large")) {
      return { ok: false, response: tooLargeFactory(c) };
    }
    return {
      ok: false,
      response: c.json(fail("invalid_json", "Body JSON invalid", c), 400),
    };
  }

  if (new TextEncoder().encode(raw).length > limit) {
    return { ok: false, response: tooLargeFactory(c) };
  }

  try {
    return { ok: true, body: JSON.parse(raw) as unknown };
  } catch {
    return {
      ok: false,
      response: c.json(fail("invalid_json", "Body JSON invalid", c), 400),
    };
  }
}

export const nameListsRouter = new Hono();

// POST /preview — multipart/form-data, field "file". Returneaza preview-ul
// (rows + totals + sha256) fara sa atinga DB-ul. UI-ul afiseaza tabelul si
// userul confirma cu /commit.
nameListsRouter.post("/preview", limitPreviewBody, async (c) => {
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "BodyLimitError") {
      return previewTooLarge(c);
    }
    return c.json(
      fail("invalid_multipart", "Multipart form-data invalid", c),
      400,
    );
  }

  const fileEntry = formData.get("file");
  if (!fileEntry || typeof fileEntry === "string") {
    return c.json(
      fail("missing_file", "Camp 'file' lipsa din form-data", c),
      400,
    );
  }
  // fileEntry este Blob/File. Vom citi arrayBuffer-ul si vom converti la
  // Buffer pentru parser. Numele fisierului vine din .name daca este File.
  const filename = (fileEntry as File).name ?? null;

  let buf: Buffer;
  try {
    const arrayBuf = await fileEntry.arrayBuffer();
    buf = Buffer.from(arrayBuf);
  } catch (err) {
    console.error("[nameLists] failed to read uploaded file:", err);
    return c.json(
      fail("invalid_multipart", "Eroare la citirea fisierului", c),
      400,
    );
  }

  // Defense-in-depth: bodyLimit middleware ar fi trebuit sa ne taie deja, dar
  // dimensiunea unui Blob poate diferi de Content-Length (boundary, headere
  // multipart). Re-aplicam cap-ul direct pe payload-ul de file.
  if (buf.length > MAX_FILE_BYTES) {
    return previewTooLarge(c);
  }

  let result: ReturnType<typeof parseNameList>;
  try {
    result = parseNameList(buf, { filename: filename ?? undefined });
  } catch (err) {
    if (err instanceof ParseError) {
      return c.json(
        fail(err.code.toLowerCase(), err.message, c),
        parseErrorStatus(err.code),
      );
    }
    console.error("[nameLists] preview parse failed:", err);
    return c.json(fail("internal_error", "Eroare la parsarea fisierului", c), 500);
  }

  return c.json(
    ok(
      {
        rows: result.rows,
        totals: result.totals,
        sha256: result.sha256,
        sourceFilename: filename,
      },
      c,
    ),
  );
});

// POST / — commit. Body JSON: {title, sourceFilename?, sourceSha256, items[],
// autoCreateJobs?, maxJobs?}. Re-valideaza items-ul, creeaza lista (idempotent
// pe sha256), opcional creeaza joburi monitoring_jobs(kind='name_soap').
nameListsRouter.post("/", limitCommitBody, async (c) => {
  const ownerId = getOwnerId(c);

  const bodyResult = await readLimitedJsonBody(c, COMMIT_BODY_LIMIT, commitTooLarge);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = CommitListBodySchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return c.json(
      fail("invalid_payload", "Payload invalid", c, parsed.error.issues),
      422,
    );
  }
  const body = parsed.data;

  // Re-derivam validation + dedup pe server. Clientul nu mai trimite flag-uri
  // de validation; le calculam aici din nameRaw + nameKind. Acelasi algoritm
  // ca preview, deci ce era 'ok' in preview ramane 'ok' la commit.
  const validated = validateRawItems(body.items);

  // createList este idempotent pe (owner_id, sourceSha256): un re-upload al
  // aceluiasi fisier returneaza lista existenta (duplicate=true), fara sa
  // re-insereze items-le. Asta lasa autoCreateJobs sa "continue" un commit
  // anterior in loc sa il dubleze.
  let listResult: ReturnType<typeof createList>;
  try {
    listResult = createList({
      ownerId,
      title: body.title,
      sourceFilename: body.sourceFilename ?? null,
      sourceSha256: body.sourceSha256,
      items: validated.rows.map((it) => ({
        nameKind: it.nameKind,
        nameRaw: it.nameRaw,
        nameNormalized: it.nameNormalized,
        cnp: it.cnp ?? null,
        cui: it.cui ?? null,
        validation: it.validation,
        validationMsg: it.validationMsg ?? null,
      })),
    });
  } catch (err) {
    console.error("[nameLists] createList failed:", err);
    return c.json(fail("internal_error", "Eroare la salvarea listei", c), 500);
  }

  // Audit row pentru creare. Doar daca lista e cu adevarat noua —
  // re-uploadul nu produce eveniment. Audit-ul "committed" (cu jobsCreated)
  // urmeaza separat dupa autoCreateJobs.
  if (!listResult.duplicate) {
    recordAudit(c, "monitoring.name_list.created", {
      targetKind: "name_list",
      targetId: String(listResult.list.id),
      detail: {
        title: listResult.list.title,
        source_sha256: listResult.list.source_sha256,
        total_rows: listResult.list.total_rows,
        valid_rows: listResult.list.valid_rows,
      },
    });
  }

  // Auto-create jobs path. Cap-ul de maxJobs este aplicat aici (default 100,
  // max 100 prin schema). getCommittableItems returneaza ok+warn nelegate de
  // un job, ordonate ASC pe id — deci batch-urile succesive consuma items in
  // ordine consistenta.
  let jobsCreated = 0;
  let jobsTotal = 0;
  let partial = false;

  if (body.autoCreateJobs) {
    const committable = getCommittableItems(ownerId, listResult.list.id);
    jobsTotal = committable.length;
    const slice = committable.slice(0, body.maxJobs);

    if (slice.length > 0) {
      const defaultAlertConfig = AlertConfigSchema.parse({});
      const defaultCadenceSec = 14400; // 4h, match cu JobCreateBaseFields.cadence_sec.default

      try {
        getDb().transaction(() => {
          for (const item of slice) {
            const jobResult = createJob({
              ownerId,
              nameListId: listResult.list.id,
              body: {
                kind: "name_soap",
                target: {
                  name_normalized: item.name_normalized,
                  name_kind: item.name_kind,
                },
                cadence_sec: defaultCadenceSec,
                alert_config: defaultAlertConfig,
              },
            });
            // linkItemToJob este idempotent (UPDATE doar daca
            // monitoring_job_id IS NULL). Daca jobul a fost creat ca
            // duplicate (target_hash collision cu un job manual deja
            // existent), legam item-ul de jobul existent. Daca item-ul
            // a fost legat intre timp de un alt request, linkItemToJob
            // returneaza false si trecem mai departe — nu raisuim.
            linkItemToJob(ownerId, item.id, jobResult.job.id);
            if (!jobResult.duplicate) {
              jobsCreated++;
            }
          }
        })();
      } catch (err) {
        console.error("[nameLists] auto-create jobs failed:", err);
        return c.json(
          fail("internal_error", "Eroare la crearea joburilor", c),
          500,
        );
      }

      // partial=true semnaleaza UI-ului ca exista items eligibile ramase
      // (jobsTotal > maxJobs). Re-trimiterea aceluiasi commit (sha256
      // identic, autoCreateJobs=true) consuma urmatorul batch.
      partial = jobsTotal > slice.length;

      // Audit bulk: un singur rind, NU 100 (un rand per job ar inunda
      // audit_log la fiecare commit mare). Detaliul listeaza jobsCreated +
      // jobsTotal ca operator sa poata reconstrui ce s-a intamplat.
      recordAudit(c, "monitoring.name_list.committed", {
        targetKind: "name_list",
        targetId: String(listResult.list.id),
        detail: {
          jobs_created: jobsCreated,
          jobs_attempted: slice.length,
          jobs_total: jobsTotal,
          partial,
          max_jobs_per_commit: MAX_JOBS_PER_COMMIT,
        },
      });
    }
  }

  // Status code:
  //   201 — fresh insert (lista noua)
  //   200 — duplicate (lista existenta returnata, optional joburi noi)
  const status = listResult.duplicate ? 200 : 201;
  return c.json(
    ok(
      {
        list: listResult.list,
        duplicate: listResult.duplicate,
        totals: validated.totals,
        jobsCreated,
        jobsTotal,
        partial,
      },
      c,
    ),
    status,
  );
});

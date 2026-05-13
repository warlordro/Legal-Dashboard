import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import { stat } from "node:fs/promises";
import { z } from "zod";
import {
  executeSearch,
  executeBulkSearch,
  executeSplitSearch,
  type BulkSearchItem,
  type BulkProgress,
  type SplitSearchProgress,
} from "../services/rnpmSearchService.ts";
import { defaultRnpmClient, RnpmError, type RnpmSearchType } from "../services/rnpmClient.ts";
import { validateSubTypeLabels } from "../services/rnpmSubTypes.ts";
import { getCaptchaBalance, type CaptchaProvider } from "../services/captchaSolver.ts";
import { getDbPath, compactDb } from "../db/schema.ts";
import {
  getBackupDir,
  deleteAllBackups,
  listBackupsWithMeta,
  restoreFromBackup,
  withMaintenanceRead,
} from "../db/backup.ts";
import { recordAudit } from "../db/auditRepository.ts";
import { mkdir } from "node:fs/promises";
import { getOwnerId } from "../middleware/owner.ts";
import { requireRole } from "../middleware/requireRole.ts";
import { getAuthMode } from "../auth/config.ts";
import { ErrorCodes, fail } from "../util/envelope.ts";

function parseProvider(v: unknown): CaptchaProvider | undefined {
  return v === "capsolver" || v === "2captcha" ? v : undefined;
}

// Body size limits — prevent DoS via oversized POST payloads
const SEARCH_BODY_LIMIT = 64 * 1024; // 64KB: single search params
const BULK_BODY_LIMIT = 512 * 1024; // 512KB: up to 200 bulk items
const EXPORT_BODY_LIMIT = 64 * 1024; // 64KB: up to 500 numeric ids
const SMALL_BODY_LIMIT = 4 * 1024; // 4KB: captcha balance

const bodyTooLarge = (c: import("hono").Context) =>
  c.json(fail(ErrorCodes.PAYLOAD_TOO_LARGE, "Payload prea mare", c), 413);
const limitSearch = bodyLimit({ maxSize: SEARCH_BODY_LIMIT, onError: bodyTooLarge });
const limitBulk = bodyLimit({ maxSize: BULK_BODY_LIMIT, onError: bodyTooLarge });
const limitExport = bodyLimit({ maxSize: EXPORT_BODY_LIMIT, onError: bodyTooLarge });
const limitSmall = bodyLimit({ maxSize: SMALL_BODY_LIMIT, onError: bodyTooLarge });

// W-1: defense in depth — cap string fields in params tree (500 chars per field, max depth 4)
const MAX_STRING_FIELD_LEN = 500;
function validateParamsDepth(obj: unknown, depth = 0): string | null {
  if (depth > 4) return "Parametri prea adanc imbricati";
  if (typeof obj === "string") {
    return obj.length > MAX_STRING_FIELD_LEN ? `Camp depaseste ${MAX_STRING_FIELD_LEN} caractere` : null;
  }
  if (obj && typeof obj === "object") {
    for (const v of Object.values(obj as Record<string, unknown>)) {
      const err = validateParamsDepth(v, depth + 1);
      if (err) return err;
    }
  }
  return null;
}

// v2.20.5: bump 60 min -> 90 min ca sa acopere worst-case-ul real al server cap-ului
// de 200 CUI in 1 stream singur. Estimare: 200 items × ~25s (worst-case ipoteci, mai
// mic pe specifice/fiducii) = ~83 min, plus margin pentru retries captcha si latenta
// upstream variabila. 60 min era sub estimare (taie stream-ul pe la item ~144) si
// auto-contradictoriu cu cap-ul ridicat in UI. 90 min ramane cap finit (taburile
// orfane nu hang-uiesc indefinit) dar acopera real flow-ul de "1 tab × 200 CUI".
const SSE_TIMEOUT_MS = 5400000;
// v2.18.0: bump 30 -> 45 min ca sa tolereze tier-2 split (destinatieInscriere).
// Worst case: ipoteci cu 18 sub-tipuri × 17s (tier-1) + 1-2 sub-tipuri care
// trigger nested cu 10 destinatii × 17s ≈ 18×17 + 2×10×17 = 646s. Plus latente
// captcha si retry, 45 min e suficient cu margin.
const SSE_SPLIT_TIMEOUT_MS = 2700000;
import {
  getAvize,
  getAvizById,
  deleteAviz,
  deleteAllAvize,
  deleteAvizeByIds,
  filterRnpmSearchResults,
  getAvizeByIds,
  getAvizStats,
  RnpmSearchNotFoundError,
} from "../db/avizRepository.ts";
import { getSearches, deleteSearch } from "../db/searchRepository.ts";
import { buildRnpmPdf } from "../services/rnpmExportPdf.ts";
import { buildRnpmXlsx } from "../services/rnpmExportXlsx.ts";

const VALID_TYPES: readonly RnpmSearchType[] = ["ipoteci", "fiducii", "specifice", "creante", "obligatiuni"];

function isValidType(t: unknown): t is RnpmSearchType {
  return typeof t === "string" && (VALID_TYPES as readonly string[]).includes(t);
}

export const rnpmRouter = new Hono();

// CP-B8: opt-in idempotency. Clients may include `clientRequestId` (uuid) in the body;
// a second request with the same (ownerId, clientRequestId) while the first is still
// in-flight returns 409. Missing `clientRequestId` = legacy behavior (no dedup).
// Web-readiness closure (v2.11.0): inflight map cheia foloseste owner-ul real
// (`getOwnerId(c)` din `ownerContext`); pe desktop ramane "local" via fallback,
// in web mode izoleaza tenants. Acelasi ownerId este propagat la
// `executeSearch`/`executeBulkSearch` ca service-ul + repo-urile sa scrie sub
// owner-ul corect — singura schimbare de comportament pe desktop e zero
// (continua sa scrie sub "local").
const inflightRequests = new Map<string, Promise<unknown>>();
function inflightKey(ownerId: string, clientRequestId: string): string {
  return `${ownerId}:${clientRequestId}`;
}
function parseClientRequestId(body: Record<string, unknown> | null): string | null {
  const v = body?.clientRequestId;
  if (typeof v !== "string") return null;
  if (v.length === 0 || v.length > 128) return null;
  return v;
}

// Web-readiness closure (#12): in `desktop` mode, `captchaKey` vine din
// safeStorage in renderer si e trimis cu fiecare request — comportament
// pastrat. In `web` mode browserul nu trebuie sa puna cheia in body
// (localStorage/inspectabil), asa ca rutele care primesc `captchaKey`
// raspund 501 pana cand exista per-user server-side storage. Rutele de
// `/saved`, `/searches`, `/stats`, `/backups/*` raman functionale; doar
// caile care fac call efectiv la captcha provider sunt blocate.
function rejectCaptchaKeyInWebMode(c: import("hono").Context): Response | null {
  if (getAuthMode() !== "web") return null;
  return c.json(
    fail(
      ErrorCodes.WEB_MODE_NOT_IMPLEMENTED,
      "RNPM in web mode necesita stocare server-side a cheii captcha. Folositi desktop sau asteptati per-user key storage.",
      c
    ),
    501
  );
}

rnpmRouter.post("/search", limitSearch, async (c) => {
  const webGate = rejectCaptchaKeyInWebMode(c);
  if (webGate) return webGate;
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "JSON invalid" }, 400);
  }
  const {
    type,
    params,
    captchaKey,
    captchaProvider,
    fallback2CaptchaKey,
    captchaMode,
    startRnpmPage,
    batchSize,
    gcode,
    searchId,
  } = (body ?? {}) as {
    type?: unknown;
    params?: unknown;
    captchaKey?: unknown;
    captchaProvider?: unknown;
    fallback2CaptchaKey?: unknown;
    captchaMode?: unknown;
    startRnpmPage?: unknown;
    batchSize?: unknown;
    gcode?: unknown;
    searchId?: unknown;
  };

  if (!isValidType(type)) return c.json({ error: "Tip cautare invalid" }, 400);
  if (!params || typeof params !== "object") return c.json({ error: "Parametri cautare lipsa" }, 400);
  const paramsErr = validateParamsDepth(params);
  if (paramsErr) return c.json({ error: paramsErr }, 400);
  if (typeof captchaKey !== "string" || captchaKey.trim().length < 10) {
    return c.json({ error: "Cheie captcha lipsa sau invalida" }, 400);
  }
  const provider = parseProvider(captchaProvider);
  const startPage = typeof startRnpmPage === "number" && startRnpmPage >= 1 && startRnpmPage <= 500 ? startRnpmPage : 1;
  const batch = typeof batchSize === "number" && batchSize >= 1 && batchSize <= 200 ? batchSize : 25;
  const existingGcode = typeof gcode === "string" && gcode.length > 0 ? gcode : undefined;
  const existingSearchId = typeof searchId === "number" && Number.isFinite(searchId) ? searchId : undefined;

  const ownerId = getOwnerId(c);
  const clientRequestId = parseClientRequestId(body as Record<string, unknown> | null);
  const dedupKey = clientRequestId ? inflightKey(ownerId, clientRequestId) : null;
  if (dedupKey && inflightRequests.has(dedupKey)) {
    return c.json({ error: "Cerere deja in curs (dedup clientRequestId)" }, 409);
  }

  // v2.20.3 Grupul K — capture searchId imediat dupa ce e creat ca abort-ul
  // client mid-search sa-l poata include in 499 body (frontend foloseste asta
  // pentru a afisa partial state din /saved).
  let createdSearchId: number | null = existingSearchId ?? null;

  const run = executeSearch({
    type,
    params: params as Parameters<typeof executeSearch>[0]["params"],
    captchaKey,
    captchaProvider: provider,
    fallback2CaptchaKey: typeof fallback2CaptchaKey === "string" ? fallback2CaptchaKey : undefined,
    captchaMode: captchaMode === "race" ? "race" : "sequential",
    ownerId,
    startRnpmPage: startPage,
    batchSize: batch,
    existingGcode,
    existingSearchId,
    signal: c.req.raw.signal,
    onSearchCreated: (sid) => {
      createdSearchId = sid;
    },
  });
  if (dedupKey) inflightRequests.set(dedupKey, run);

  try {
    const result = await run;
    return c.json({
      searchId: result.searchId,
      total: result.total,
      pagesTotal: result.pagesTotal,
      pageSize: result.pageSize,
      currentPage: result.currentPage,
      criteriu: result.criteriu,
      documents: result.documents,
      avizIds: result.avizIds,
      detailsFailed: result.detailsFailed,
      gcode: result.gcode,
      nextRnpmPage: result.nextRnpmPage,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      console.log("[rnpm/search] aborted by client");
      // 499 = Client Closed Request (non-standard but widely used by nginx/others).
      // Hono's typed status codes exclude it, so emit via a plain Response.
      // v2.20.3 Grupul K: include searchId daca a fost creat (null daca abort
      // s-a intamplat inainte de saveSearch).
      return new Response(JSON.stringify({ error: "Cautare oprita", searchId: createdSearchId }), {
        status: 499,
        headers: { "Content-Type": "application/json" },
      });
    }
    // Structured "limit exceeded" — frontend foloseste `code` + `splittable` ca sa
    // ofere split via tipInscriere. Restul erorilor RNPM/JSON ramane 500 generic.
    if (e instanceof RnpmError && e.code === "limit_exceeded") {
      const total = typeof e.details?.total === "number" ? e.details.total : undefined;
      const limit = typeof e.details?.limit === "number" ? e.details.limit : undefined;
      return c.json(
        {
          error: e.message,
          code: "limit_exceeded",
          total,
          limit,
          splittable: { type },
        },
        400
      );
    }
    const msg = e instanceof Error ? e.message : "Eroare necunoscuta";
    console.error("[rnpm/search]", msg);
    return c.json({ error: msg }, 500);
  } finally {
    if (dedupKey) inflightRequests.delete(dedupKey);
  }
});

// ============================================================================
// POST /search/:searchId/filter - v2.24.0 filtru text peste rezultate cautare RNPM.
// Spec: docs/superpowers/specs/2026-05-13-rnpm-results-text-filter-design.md
// ============================================================================

const FILTER_CONTROL_CHARS_CLASS = "\\u0000-\\u001F\\u007F\\u200B-\\u200F\\uFEFF";
const FILTER_CONTROL_CHARS_RE = new RegExp(`[${FILTER_CONTROL_CHARS_CLASS}]`, "g");

const FilterBodySchema = z.object({
  q: z
    .string()
    .max(200, "Termen prea lung (max 200 caractere)")
    .transform((s) => s.trim())
    .refine((s) => s.length >= 2, "Minim 2 caractere dupa trim")
    .transform((s) => s.replace(FILTER_CONTROL_CHARS_RE, "")),
});

const SearchIdSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);

function logFilterEvent(entry: Record<string, unknown>): void {
  console.log(JSON.stringify({ ...entry, ts: new Date().toISOString() }));
}

rnpmRouter.post("/search/:searchId/filter", limitSearch, async (c) => {
  if (process.env.RNPM_RESULTS_FILTER_DISABLED === "1") {
    return c.json({ error: "Filtrul de rezultate RNPM este dezactivat temporar.", code: "FILTER_DISABLED" }, 503);
  }

  const sidParsed = SearchIdSchema.safeParse(c.req.param("searchId"));
  if (!sidParsed.success) {
    return c.json({ error: "searchId invalid" }, 400);
  }
  const searchId = sidParsed.data;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "JSON invalid" }, 400);
  }
  const parsed = FilterBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Body invalid" }, 400);
  }
  const { q } = parsed.data;

  const ownerId = getOwnerId(c);
  const t0 = Date.now();

  const timeoutSignal = AbortSignal.timeout(5000);
  const signal = AbortSignal.any([c.req.raw.signal, timeoutSignal]);

  try {
    const result = await withMaintenanceRead(async () => filterRnpmSearchResults({ ownerId, searchId, q, signal }));

    logFilterEvent({
      action: "rnpm.results.filter",
      ownerId,
      searchId,
      qLen: q.length,
      matchedCount: result.matchedCount,
      truncated: result.truncated,
      missingDetails: result.missingDetails,
      latencyMs: Date.now() - t0,
      status: "ok",
    });

    return c.json(result, 200);
  } catch (err) {
    const latencyMs = Date.now() - t0;
    if (err instanceof RnpmSearchNotFoundError) {
      logFilterEvent({
        action: "rnpm.results.filter",
        ownerId,
        searchId,
        qLen: q.length,
        latencyMs,
        status: "not_found",
      });
      return c.json({ error: "Search inexistent" }, 404);
    }
    if (err instanceof Error && err.name === "AbortError") {
      if (timeoutSignal.aborted) {
        logFilterEvent({
          action: "rnpm.results.filter",
          ownerId,
          searchId,
          qLen: q.length,
          latencyMs,
          status: "timeout",
        });
        return c.json({ error: "Timeout filtrare", code: "FILTER_TIMEOUT" }, 503);
      }
      logFilterEvent({
        action: "rnpm.results.filter",
        ownerId,
        searchId,
        qLen: q.length,
        latencyMs,
        status: "abort",
      });
      return new Response(null, { status: 499 });
    }
    logFilterEvent({
      action: "rnpm.results.filter",
      ownerId,
      searchId,
      qLen: q.length,
      latencyMs,
      status: "error",
    });
    console.error("[rnpm.filter] eroare neasteptata", err);
    return c.json({ error: "Eroare interna filtrare" }, 500);
  }
});

rnpmRouter.post("/bulk", limitBulk, async (c) => {
  const webGate = rejectCaptchaKeyInWebMode(c);
  if (webGate) return webGate;
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "JSON invalid" }, 400);
  }
  const { items, captchaKey, captchaProvider, fallback2CaptchaKey, captchaMode } = (body ?? {}) as {
    items?: unknown;
    captchaKey?: unknown;
    captchaProvider?: unknown;
    fallback2CaptchaKey?: unknown;
    captchaMode?: unknown;
  };

  if (!Array.isArray(items) || items.length === 0) return c.json({ error: "Lista cautari goala" }, 400);
  if (items.length > 200) return c.json({ error: "Maxim 200 cautari per bulk" }, 400);
  if (typeof captchaKey !== "string" || captchaKey.trim().length < 10) {
    return c.json({ error: "Cheie captcha lipsa sau invalida" }, 400);
  }
  const provider = parseProvider(captchaProvider);

  const ownerId = getOwnerId(c);
  const clientRequestId = parseClientRequestId(body as Record<string, unknown> | null);
  const dedupKey = clientRequestId ? inflightKey(ownerId, clientRequestId) : null;

  const validItems: BulkSearchItem[] = [];
  for (const it of items) {
    const item = it as { type?: unknown; params?: unknown; label?: unknown };
    if (!isValidType(item.type)) return c.json({ error: "Tip cautare invalid in lista" }, 400);
    if (!item.params || typeof item.params !== "object") return c.json({ error: "Parametri invalidi" }, 400);
    const paramsErr = validateParamsDepth(item.params);
    if (paramsErr) return c.json({ error: paramsErr }, 400);
    validItems.push({
      type: item.type,
      params: item.params as BulkSearchItem["params"],
      label: typeof item.label === "string" ? item.label : undefined,
    });
  }

  // CP-B8 (v2.20.3): rezervare sincrona DUPA validare, INAINTE de streamSSE.
  // Hono streamSSE invoca cb-ul sincron (cb-ul ruleaza pana la primul await
  // inainte ca streamSSE sa returneze), deci varianta veche cu set() in
  // interiorul cb-ului era de facto race-free. Forma actuala face contractul
  // explicit: orice refactor care strecoara un await intre has() si set()
  // (sau care schimba semantica streamSSE) nu mai poate sparge dedup-ul.
  // Bonus: evita leak-ul potential pe early-return din loop-ul de validare
  // si decupleaza dedup-ul de fluxul SSE. Sentinel `Promise.resolve()` —
  // Map-ul e folosit doar pentru has(), valoarea e indiferenta.
  if (dedupKey) {
    if (inflightRequests.has(dedupKey)) {
      return c.json({ error: "Bulk deja in curs (dedup clientRequestId)" }, 409);
    }
    inflightRequests.set(dedupKey, Promise.resolve());
  }

  return streamSSE(c, async (stream) => {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    c.req.raw.signal?.addEventListener?.("abort", onAbort);

    // SSE hard timeout — guarantee the stream never hangs indefinitely
    const timeoutHandle = setTimeout(() => controller.abort(), SSE_TIMEOUT_MS);

    const send = (p: BulkProgress) =>
      stream.writeSSE({
        event: "progress",
        data: JSON.stringify(p),
      });

    const bulkRun = executeBulkSearch(
      validItems,
      captchaKey,
      ownerId,
      (p) => {
        void send(p);
      },
      defaultRnpmClient,
      controller.signal,
      provider,
      typeof fallback2CaptchaKey === "string" ? fallback2CaptchaKey : undefined,
      captchaMode === "race" ? "race" : "sequential"
    );

    try {
      await bulkRun;
      await stream.writeSSE({ event: "complete", data: "{}" });
    } catch (e) {
      // v2.20.3 Grupul K + L — diferentiere abort/timeout vs error generic.
      // Bulk emite searchId per-item via progress events, deci nu mai e nevoie
      // sa-l surface din nou aici.
      if (e instanceof DOMException && e.name === "AbortError") {
        const clientAborted = c.req.raw.signal?.aborted === true;
        const eventName = clientAborted ? "aborted" : "timeout";
        await stream.writeSSE({
          event: eventName,
          data: JSON.stringify({
            reason: clientAborted ? "client_aborted" : "server_timeout",
            timeoutMs: clientAborted ? undefined : SSE_TIMEOUT_MS,
          }),
        });
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        await stream.writeSSE({ event: "error", data: JSON.stringify({ error: msg }) });
      }
    } finally {
      clearTimeout(timeoutHandle);
      c.req.raw.signal?.removeEventListener?.("abort", onAbort);
      if (dedupKey) inflightRequests.delete(dedupKey);
    }
  });
});

// Split search via tipInscriere — fallback la cautari care depasesc cap-ul RNPM
// de 1500 rezultate. Frontend trimite `subTypeLabels` (ordonate, indexate 1-based)
// dupa confirmare; backend ruleaza N executeSearch independente, fiecare cu
// {tipInscriere: {type: "1", value: "<i+1>"}} si emite progress per sub-tip.
// Sub-tipurile care singure depasesc cap-ul sunt marcate "blocked" cu gapReason
// (terminal_cap / silent_refusal / residual_unclassified) si skipped; celelalte
// continua. Vezi rnpmSearchService.executeSplitSearch.
rnpmRouter.post("/search-split", limitSearch, async (c) => {
  const webGate = rejectCaptchaKeyInWebMode(c);
  if (webGate) return webGate;
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "JSON invalid" }, 400);
  }
  const { type, baseParams, subTypeLabels, captchaKey, captchaProvider, fallback2CaptchaKey, captchaMode } = (body ??
    {}) as {
    type?: unknown;
    baseParams?: unknown;
    subTypeLabels?: unknown;
    captchaKey?: unknown;
    captchaProvider?: unknown;
    fallback2CaptchaKey?: unknown;
    captchaMode?: unknown;
  };

  if (!isValidType(type)) return c.json({ error: "Tip cautare invalid" }, 400);
  if (!baseParams || typeof baseParams !== "object") return c.json({ error: "Parametri cautare lipsa" }, 400);
  const paramsErr = validateParamsDepth(baseParams);
  if (paramsErr) return c.json({ error: paramsErr }, 400);
  if (!Array.isArray(subTypeLabels) || subTypeLabels.length === 0) {
    return c.json({ error: "Lista sub-tipuri goala" }, 400);
  }
  if (subTypeLabels.length > 50) {
    return c.json({ error: "Maxim 50 sub-tipuri per split" }, 400);
  }
  for (const label of subTypeLabels) {
    if (typeof label !== "string" || label.length === 0 || label.length > 200) {
      return c.json({ error: "Sub-tip invalid in lista" }, 400);
    }
  }
  // v2.20.3 Grupul O — allow-list canonica per categorie (mirror backend al
  // frontend/src/components/rnpm/rnpm-form-constants.ts). Pana acum backend
  // accepta orice string array, ceea ce permitea drift sau tampering pe
  // indexarea 1-based pe care RNPM o asteapta in `tipInscriere.value`.
  const canonicalErr = validateSubTypeLabels(type, subTypeLabels as string[]);
  if (canonicalErr) {
    return c.json({ error: canonicalErr }, 400);
  }
  if (typeof captchaKey !== "string" || captchaKey.trim().length < 10) {
    return c.json({ error: "Cheie captcha lipsa sau invalida" }, 400);
  }
  const provider = parseProvider(captchaProvider);

  const ownerId = getOwnerId(c);
  const clientRequestId = parseClientRequestId(body as Record<string, unknown> | null);
  const dedupKey = clientRequestId ? inflightKey(ownerId, clientRequestId) : null;
  // CP-B8 (v2.20.3): vezi nota pe ruta /bulk — aceeasi rezervare sincrona
  // inainte de streamSSE, ca contract explicit. Valoarea Map-ului e sentinel.
  if (dedupKey) {
    if (inflightRequests.has(dedupKey)) {
      return c.json({ error: "Split deja in curs (dedup clientRequestId)" }, 409);
    }
    inflightRequests.set(dedupKey, Promise.resolve());
  }

  return streamSSE(c, async (stream) => {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    c.req.raw.signal?.addEventListener?.("abort", onAbort);
    const timeoutHandle = setTimeout(() => controller.abort(), SSE_SPLIT_TIMEOUT_MS);

    const send = (p: SplitSearchProgress) =>
      stream.writeSSE({
        event: "progress",
        data: JSON.stringify(p),
      });

    // v2.20.3 Grupul K — capture parentSearchId imediat ce e creat, ca abort-ul
    // sau timeout-ul mid-search sa poata emite SSE `aborted`/`timeout` cu
    // searchId. Fara asta, frontend pierdea referinta si nu putea afisa
    // partial state din istoric.
    let parentSearchId: number | null = null;

    const splitRun = executeSplitSearch(
      {
        type,
        baseParams: baseParams as Parameters<typeof executeSplitSearch>[0]["baseParams"],
        subTypeLabels: subTypeLabels as string[],
        captchaKey,
        captchaProvider: provider,
        fallback2CaptchaKey: typeof fallback2CaptchaKey === "string" ? fallback2CaptchaKey : undefined,
        captchaMode: captchaMode === "race" ? "race" : "sequential",
        ownerId,
        signal: controller.signal,
        onSearchCreated: (sid) => {
          parentSearchId = sid;
          // Emite "started" SSE imediat ca front-ul sa stie searchId-ul chiar
          // daca user-ul aborteaza inainte de prima sub-cautare.
          void stream.writeSSE({
            event: "started",
            data: JSON.stringify({ searchId: sid }),
          });
        },
      },
      (p) => {
        void send(p);
      },
      defaultRnpmClient
    );

    try {
      const result = await splitRun;
      // Audit observability: log gap-uri reziduale (rezultate care nu au putut fi
      // recuperate via tier-1+tier-2). Util pentru a urmari frecventa cazurilor
      // terminal_cap / silent_refusal / residual_unclassified pe productie.
      // v2.20.3 Grupul O — kill switch operational: daca audit_log creste prea
      // repede sau daca un incident ne forteaza dezactivarea temporara, set
      // RNPM_AUDIT_CAP_HIT_DISABLED=1 sare INSERT-ul rnpm.cap_hit fara restart.
      const auditCapHitDisabled = process.env.RNPM_AUDIT_CAP_HIT_DISABLED === "1";
      const blockedStats = result.splitStats.filter((s) => s.status === "blocked" || s.status === "partial");
      if (!auditCapHitDisabled && (blockedStats.length > 0 || result.upstreamTotal !== result.total)) {
        const gapByReason: Record<string, number> = {};
        // Tier-1 contributors: foloseste s.gap (deja calculat in service) cand exista,
        // altfel cade la max(0, subTotal - count). Evita dublu-numararea pentru
        // status === "partial" unde s.gap = subTotal - SUM(nested.subTotal).
        for (const s of blockedStats) {
          if (s.gapReason) {
            const missing = s.gap ?? Math.max(0, (s.subTotal ?? 0) - (s.count ?? 0));
            gapByReason[s.gapReason] = (gapByReason[s.gapReason] ?? 0) + missing;
          }
          // Tier-2 nested gaps (residual_unclassified pe tier-1 nu acopera asta —
          // fiecare destinatie blocata individual emite propriul gapReason).
          if (s.nested) {
            for (const n of s.nested) {
              if (n.gapReason) {
                const missing = Math.max(0, (n.subTotal ?? 0) - (n.count ?? 0));
                gapByReason[n.gapReason] = (gapByReason[n.gapReason] ?? 0) + missing;
              }
            }
          }
        }
        // blockedLabels include atat tier-1 cat si tier-2 (cu prefix "tier1 > tier2"
        // pentru destinatii). Cap la 20 ca sa nu poluam audit_log la search-uri patologice.
        const blockedLabels: Array<{
          label: string;
          status: string;
          gapReason?: string;
          subTotal?: number;
          count?: number;
        }> = [];
        for (const s of blockedStats) {
          blockedLabels.push({
            label: s.label,
            status: s.status,
            gapReason: s.gapReason,
            subTotal: s.subTotal,
            count: s.count,
          });
          if (s.nested) {
            for (const n of s.nested) {
              if (n.status === "blocked" || n.status === "error") {
                blockedLabels.push({
                  label: `${s.label} > ${n.label}`,
                  status: n.status,
                  gapReason: n.gapReason,
                  subTotal: n.subTotal,
                  count: n.count,
                });
              }
            }
          }
        }
        const cappedLabels = blockedLabels.slice(0, 20);
        // recordAudit propaga erori (cf. auditRepository.ts header). Un INSERT
        // esuat in audit_log NU trebuie sa flip-uiasca success-ul SSE in error,
        // asa ca izolam local — observability != hard dependency.
        try {
          recordAudit(c, "rnpm.cap_hit", {
            targetKind: "search",
            targetId: String(result.searchId),
            detail: {
              // searchType e enum low-cardinality (RnpmSearchType), nu PII.
              // criteriu (CUI/CNP/nume) NU se loga in detail — duplicat al
              // payload-ului de cautare; gdpr-friendly daca audit_log e exportat.
              searchType: type,
              upstreamTotal: result.upstreamTotal,
              recovered: result.total,
              gap: result.upstreamTotal - result.total,
              gapByReason,
              blockedLabels: cappedLabels,
              blockedLabelsTruncated: blockedLabels.length > cappedLabels.length,
            },
          });
        } catch (auditErr) {
          console.warn(
            `[rnpm.cap_hit] audit insert failed for searchId=${result.searchId}: ${
              auditErr instanceof Error ? auditErr.message : String(auditErr)
            }`
          );
        }
      }
      await stream.writeSSE({
        event: "complete",
        data: JSON.stringify(result),
      });
    } catch (e) {
      // v2.20.3 Grupul K + L — diferentiere abort/timeout vs error generic ca
      // frontend-ul sa stie ce sa afiseze (toast "anulat" vs "eroare"), si sa
      // includa searchId daca a fost creat (partial state recoverable din
      // istoric, vezi /saved). Timeout-ul intern (SSE_SPLIT_TIMEOUT_MS)
      // declanseaza tot AbortError pe controller, distinctia se face prin
      // c.req.raw.signal.aborted (true = client a inchis) vs false (timeout intern).
      if (e instanceof DOMException && e.name === "AbortError") {
        const clientAborted = c.req.raw.signal?.aborted === true;
        const eventName = clientAborted ? "aborted" : "timeout";
        await stream.writeSSE({
          event: eventName,
          data: JSON.stringify({
            searchId: parentSearchId,
            reason: clientAborted ? "client_aborted" : "server_timeout",
            timeoutMs: clientAborted ? undefined : SSE_SPLIT_TIMEOUT_MS,
          }),
        });
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({ error: msg, searchId: parentSearchId }),
        });
      }
    } finally {
      clearTimeout(timeoutHandle);
      c.req.raw.signal?.removeEventListener?.("abort", onAbort);
      if (dedupKey) inflightRequests.delete(dedupKey);
    }
  });
});

const SORT_KEYS = new Set(["id", "identificator", "search_type", "data", "tip", "activ"]);

rnpmRouter.get("/saved", (c) => {
  const pageRaw = Number(c.req.query("page") ?? 0);
  const pageSizeRaw = Number(c.req.query("pageSize") ?? 25);
  const searchType = c.req.query("searchType") ?? undefined;
  const activStr = c.req.query("activ");
  const activ = activStr == null ? undefined : activStr === "true";
  const searchText = c.req.query("q") ?? undefined;
  const sortKeyRaw = c.req.query("sortKey");
  const sortDirRaw = c.req.query("sortDir");

  const result = getAvize({
    ownerId: getOwnerId(c),
    page: Number.isFinite(pageRaw) ? pageRaw : 0,
    pageSize: Number.isFinite(pageSizeRaw) ? pageSizeRaw : 25,
    searchType,
    activ,
    searchText,
    dataStart: c.req.query("dataStart") ?? undefined,
    dataStop: c.req.query("dataStop") ?? undefined,
    sortKey:
      sortKeyRaw && SORT_KEYS.has(sortKeyRaw)
        ? (sortKeyRaw as "id" | "identificator" | "search_type" | "data" | "tip" | "activ")
        : undefined,
    sortDir: sortDirRaw === "asc" || sortDirRaw === "desc" ? sortDirRaw : undefined,
  });
  return c.json(result);
});

rnpmRouter.get("/saved/:id", (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "ID invalid" }, 400);
  const aviz = getAvizById(id, getOwnerId(c));
  if (!aviz) return c.json({ error: "Aviz inexistent" }, 404);
  return c.json(aviz);
});

rnpmRouter.delete("/saved/all", requireRole("admin"), (c) => {
  const count = deleteAllAvize(getOwnerId(c));
  // "Sterge baza" must actually free disk space, not just remove rows — run VACUUM +
  // WAL truncate so the file shrinks from ~hundreds of MB back to the schema size.
  try {
    compactDb();
  } catch (e) {
    console.warn("[rnpm] compact after delete-all failed:", e);
  }
  // Audit 2026-04-29 #15: ops destructive masive trebuie reconstruibile.
  recordAudit(c, "aviz.delete_all", {
    targetKind: "aviz",
    detail: { deleted: count },
  });
  return c.json({ deleted: count });
});

rnpmRouter.post("/saved/delete-batch", limitExport, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "JSON invalid" }, 400);
  }
  const { ids } = (body ?? {}) as { ids?: unknown };
  if (!Array.isArray(ids) || ids.length === 0) return c.json({ error: "Lista id-uri goala" }, 400);
  const numIds = ids.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (numIds.length === 0) return c.json({ error: "Lista id-uri invalida" }, 400);
  if (numIds.length > 500) return c.json({ error: "Maxim 500 avize per batch" }, 400);
  const deleted = deleteAvizeByIds(numIds, getOwnerId(c));
  recordAudit(c, "aviz.delete_batch", {
    targetKind: "aviz",
    detail: { requested: numIds.length, deleted },
  });
  return c.json({ deleted });
});

rnpmRouter.get("/stats", async (c) => {
  const stats = getAvizStats(getOwnerId(c));
  const dbPath = getDbPath();
  // CP-B4: async fs so handler does not block the event loop under concurrency (web mode).
  const sizeOf = async (p: string): Promise<number> => {
    try {
      return (await stat(p)).size;
    } catch {
      return 0;
    }
  };
  const [main, wal, shm] = await Promise.all([sizeOf(dbPath), sizeOf(`${dbPath}-wal`), sizeOf(`${dbPath}-shm`)]);
  return c.json({ ...stats, db: { path: dbPath, sizeBytes: main + wal + shm } });
});

// Desktop-only: reveal the DB file in the system file manager via Electron shell.
// `require("electron")` is marked external at bundle time (scripts/build.js) so it
// resolves at runtime inside the main process; web deployments will hit the catch
// and return 501.
rnpmRouter.post("/open-db-folder", requireRole("admin"), (c) => {
  const dbPath = getDbPath();
  try {
    // esbuild emits `require("electron")` verbatim in the CJS bundle because
    // electron is marked external (scripts/build.js). At runtime inside Electron's
    // main process the CJS loader resolves it; outside Electron it throws.
    const electron = require("electron") as { shell?: { showItemInFolder?: (p: string) => void } };
    if (!electron?.shell?.showItemInFolder) {
      return c.json({ error: "Functie disponibila doar in Electron" }, 501);
    }
    electron.shell.showItemInFolder(dbPath);
    return c.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Eroare deschidere folder";
    return c.json({ error: msg }, 500);
  }
});

rnpmRouter.post("/compact", requireRole("admin"), (c) => {
  try {
    const result = compactDb();
    return c.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Eroare compactare baza";
    return c.json({ error: msg }, 500);
  }
});

// Tier 4 #21: destructive backup ops are audit-logged so a web/admin mode
// later can reconstruct who wiped/rolled back the database. Audit on both
// success and failure paths — a failed restore that left a pre-restore
// snapshot behind still matters for reconstruction.
rnpmRouter.delete("/backups", requireRole("admin"), async (c) => {
  try {
    const deleted = await deleteAllBackups();
    recordAudit(c, "backup.delete_all", {
      targetKind: "backup",
      detail: { deleted },
    });
    return c.json({ deleted });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Eroare stergere backups";
    recordAudit(c, "backup.delete_all", {
      targetKind: "backup",
      outcome: "error",
      detail: { error: msg },
    });
    return c.json({ error: msg }, 500);
  }
});

rnpmRouter.get("/backups", requireRole("admin"), async (c) => {
  try {
    const backups = await listBackupsWithMeta();
    return c.json({ backups });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Eroare listare backups";
    return c.json({ error: msg }, 500);
  }
});

rnpmRouter.post("/backups/restore", requireRole("admin"), limitSmall, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "JSON invalid" }, 400);
  }
  const name = (body as { name?: unknown })?.name;
  if (typeof name !== "string" || name.length === 0) {
    return c.json({ error: "Nume backup lipsa" }, 400);
  }
  try {
    const { preRestoreName } = await restoreFromBackup(name);
    recordAudit(c, "backup.restore", {
      targetKind: "backup",
      targetId: name,
      detail: { preRestoreName },
    });
    return c.json({ ok: true, preRestoreName });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Eroare restore";
    recordAudit(c, "backup.restore", {
      targetKind: "backup",
      targetId: name,
      outcome: "error",
      detail: { error: msg },
    });
    return c.json({ error: msg }, 500);
  }
});

rnpmRouter.post("/open-backups-folder", requireRole("admin"), async (c) => {
  const dir = getBackupDir();
  try {
    await mkdir(dir, { recursive: true });
    const electron = require("electron") as { shell?: { openPath?: (p: string) => Promise<string> } };
    if (!electron?.shell?.openPath) {
      return c.json({ error: "Functie disponibila doar in Electron" }, 501);
    }
    const err = await electron.shell.openPath(dir);
    if (err) return c.json({ error: err }, 500);
    return c.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Eroare deschidere folder backups";
    return c.json({ error: msg }, 500);
  }
});

rnpmRouter.delete("/saved/:id", (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "ID invalid" }, 400);
  const ok = deleteAviz(id, getOwnerId(c));
  recordAudit(c, "aviz.delete", {
    targetKind: "aviz",
    targetId: String(id),
    outcome: ok ? "ok" : "error",
    detail: { found: ok },
  });
  return c.json({ deleted: ok });
});

rnpmRouter.post("/saved/export", limitExport, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "JSON invalid" }, 400);
  }
  const { ids } = (body ?? {}) as { ids?: unknown };
  if (!Array.isArray(ids) || ids.length === 0) return c.json({ error: "Lista id-uri goala" }, 400);
  const numIds = ids.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (numIds.length === 0) return c.json({ error: "Lista id-uri invalida" }, 400);
  if (numIds.length > 500) return c.json({ error: "Maxim 500 avize per export" }, 400);
  return c.json({ items: getAvizeByIds(numIds, getOwnerId(c)) });
});

// Server-side XLSX export. Replaces the frontend Web Worker build, which OOM'd
// the Electron renderer at ~150 avizi (peak heap ~2.7GB). Backend builds the
// workbook and streams the binary back; frontend just triggers the download.
//
// Body: { ids: number[]; searchType?: string }. Same 500-id cap as /saved/export.
// `searchType` controls layout (sheet count + columns) for "specifice" vs others.
rnpmRouter.post("/saved/export.xlsx", limitExport, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "JSON invalid" }, 400);
  }
  const { ids, searchType } = (body ?? {}) as { ids?: unknown; searchType?: unknown };
  if (!Array.isArray(ids) || ids.length === 0) return c.json({ error: "Lista id-uri goala" }, 400);
  const numIds = ids.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (numIds.length === 0) return c.json({ error: "Lista id-uri invalida" }, 400);
  if (numIds.length > 500) return c.json({ error: "Maxim 500 avize per export" }, 400);
  const searchTypeStr =
    typeof searchType === "string" && searchType.length > 0 && searchType.length <= 64 ? searchType : undefined;

  const items = getAvizeByIds(numIds, getOwnerId(c));
  if (items.length === 0) return c.json({ error: "Nicio inregistrare gasita" }, 404);

  const result = await buildRnpmXlsx(items, searchTypeStr);
  const [{ createReadStream }, { unlink }, { Readable }] = await Promise.all([
    import("node:fs"),
    import("node:fs/promises"),
    import("node:stream"),
  ]);
  const fileStream = createReadStream(result.filepath);
  // Cleanup waits for stream close; a route-level finally would delete before the response is consumed.
  fileStream.once("close", () => {
    void unlink(result.filepath).catch(() => {});
  });

  // Content-Disposition: include both filename= (legacy fallback) and filename*=UTF-8 (RFC 5987)
  // so the frontend can read the name without round-tripping a separate metadata call.
  const safeAscii = result.filename.replace(/[^A-Za-z0-9._-]+/g, "_");
  c.header("Content-Type", result.mime);
  c.header("Content-Length", String(result.byteLength));
  c.header(
    "Content-Disposition",
    `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`
  );
  c.header("Cache-Control", "no-store");
  return c.body(Readable.toWeb(fileStream) as unknown as ReadableStream);
});

rnpmRouter.post("/saved/export.pdf", limitExport, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "JSON invalid" }, 400);
  }
  const { ids, searchType } = (body ?? {}) as { ids?: unknown; searchType?: unknown };
  if (!Array.isArray(ids) || ids.length === 0) return c.json({ error: "Lista id-uri goala" }, 400);
  const numIds = ids.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (numIds.length === 0) return c.json({ error: "Lista id-uri invalida" }, 400);
  if (numIds.length > 500) return c.json({ error: "Maxim 500 avize per export" }, 400);
  const searchTypeStr =
    typeof searchType === "string" && searchType.length > 0 && searchType.length <= 64 ? searchType : undefined;

  const items = getAvizeByIds(numIds, getOwnerId(c));
  if (items.length === 0) return c.json({ error: "Nicio inregistrare gasita" }, 404);

  const result = await buildRnpmPdf(items, searchTypeStr);
  const [{ createReadStream }, { unlink }, { Readable }] = await Promise.all([
    import("node:fs"),
    import("node:fs/promises"),
    import("node:stream"),
  ]);
  const fileStream = createReadStream(result.filepath);
  // Cleanup waits for stream close; a route-level finally would delete before the response is consumed.
  fileStream.once("close", () => {
    void unlink(result.filepath).catch(() => {});
  });

  const safeAscii = result.filename.replace(/[^A-Za-z0-9._-]+/g, "_");
  c.header("Content-Type", result.mime);
  c.header("Content-Length", String(result.byteLength));
  c.header(
    "Content-Disposition",
    `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`
  );
  c.header("Cache-Control", "no-store");
  return c.body(Readable.toWeb(fileStream) as unknown as ReadableStream);
});

// Cursor pagination is intentional here — deliberate deviation from the
// CLAUDE.md "offset-based on listari principale" guideline. RNPM searches is
// a personal history log (monotonically growing IDs, "load more" UX, no
// "page 5 of 12" indicator), where cursor wins on two counts:
//   1. Inserts at the head don't shift offsets of older rows mid-scroll.
//   2. No SELECT COUNT(*) per page hit — `total` is meaningless for a stream.
// The offset rule applies to enumerable listings (admin users, audit,
// monitoring jobs, alerts inbox) where total + page numbers matter for the
// UI. Locked by characterization test in routes/rnpm.contract.test.ts.
rnpmRouter.get("/searches", (c) => {
  const limit = Number(c.req.query("limit") ?? 50);
  const cursorStr = c.req.query("cursor");
  const cursor = cursorStr ? Number(cursorStr) : null;
  return c.json(
    getSearches({
      ownerId: getOwnerId(c),
      limit: Number.isFinite(limit) ? limit : 50,
      cursor: Number.isFinite(cursor as number) ? (cursor as number) : null,
    })
  );
});

rnpmRouter.delete("/searches/:id", (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "ID invalid" }, 400);
  const deleted = deleteSearch(id, getOwnerId(c));
  recordAudit(c, "search.delete", {
    targetKind: "search",
    targetId: String(id),
    outcome: deleted ? "ok" : "error",
    detail: { found: deleted },
  });
  return c.json({ deleted });
});

rnpmRouter.post("/captcha/balance", limitSmall, async (c) => {
  const webGate = rejectCaptchaKeyInWebMode(c);
  if (webGate) return webGate;
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "JSON invalid" }, 400);
  }
  const { captchaKey, captchaProvider } = (body ?? {}) as { captchaKey?: unknown; captchaProvider?: unknown };
  if (typeof captchaKey !== "string") return c.json({ error: "Cheie lipsa" }, 400);
  try {
    const balance = await getCaptchaBalance(captchaKey, parseProvider(captchaProvider));
    return c.json({ balance });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Eroare";
    return c.json({ error: msg }, 400);
  }
});

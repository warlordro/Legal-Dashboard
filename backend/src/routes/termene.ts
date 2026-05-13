import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cautareDosare } from "../soap.ts";
import { defaultDateRange, generateMonthlyIntervals } from "../intervals.ts";
import {
  MAX_DOSARE_RESPONSE,
  MAX_INSTITUTII,
  MAX_SOAP_FANOUT,
  MAX_SSE_INTERVALS,
  SSE_TIMEOUT_MS,
  validateParams,
} from "../util/validation.ts";
import { batchFetchDosare, parseExistingFromBody, sseEvent } from "../services/batch-dosare.ts";
import { buildTermenePdf } from "../services/termeneExportPdf.ts";
import { buildTermeneXlsx, type TermenExportRow } from "../services/termeneExportXlsx.ts";

export const termeneRouter = new Hono();
export const termeneExportRouter = new Hono();

// 25MB acopera MAX_TERMENE_EXPORT=100k termene (~200B/termen flat); hard cap inainte
// sa incarcam payload in RAM. Vezi rationale identic in routes/dosare.ts.
const EXPORT_BODY_LIMIT = 25 * 1024 * 1024;
const MAX_TERMENE_EXPORT = 100_000;
const limitExport = bodyLimit({
  maxSize: EXPORT_BODY_LIMIT,
  onError: (c) => c.json({ error: "Payload prea mare" }, 413),
});

function isTermenShape(value: unknown): value is TermenExportRow {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  // Builderii citesc numarDosar + data ca minim; parti e optional dar trebuie
  // sa fie array daca exista. Restul (ora, complet, solutie, etc.) tolereaza
  // null via fallback "-".
  if (typeof v.numarDosar !== "string") return false;
  if (v.parti !== undefined && !Array.isArray(v.parti)) return false;
  return true;
}

async function readTermeneExportBody(c: import("hono").Context) {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return { error: c.json({ error: "JSON invalid" }, 400) };
  }
  const { termene } = (body ?? {}) as { termene?: unknown };
  if (!Array.isArray(termene)) return { error: c.json({ error: "Lista termene invalida" }, 400) };
  if (termene.length === 0) return { error: c.json({ error: "Lista termene goala" }, 400) };
  if (termene.length > MAX_TERMENE_EXPORT) {
    return { error: c.json({ error: `Maxim ${MAX_TERMENE_EXPORT} termene per export` }, 400) };
  }
  const badIndex = termene.findIndex((item) => !isTermenShape(item));
  if (badIndex !== -1) {
    return { error: c.json({ error: `Format termen invalid la pozitia ${badIndex}` }, 400) };
  }
  return { termene: termene as TermenExportRow[] };
}

async function streamExportResult(
  c: import("hono").Context,
  result: { filepath: string; filename: string; mime: string; byteLength: number }
) {
  const [{ createReadStream }, { unlink }, { Readable }] = await Promise.all([
    import("node:fs"),
    import("node:fs/promises"),
    import("node:stream"),
  ]);
  const fileStream = createReadStream(result.filepath);
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
}

termeneExportRouter.post("/export.xlsx", limitExport, async (c) => {
  const parsed = await readTermeneExportBody(c);
  if ("error" in parsed) return parsed.error;
  const result = await buildTermeneXlsx(parsed.termene);
  return streamExportResult(c, result);
});

termeneExportRouter.post("/export.pdf", limitExport, async (c) => {
  const parsed = await readTermeneExportBody(c);
  if ("error" in parsed) return parsed.error;
  const result = await buildTermenePdf(parsed.termene);
  return streamExportResult(c, result);
});

// Termene = extrage sedintele din dosare
termeneRouter.get("/", async (c) => {
  const { numarDosar, obiectDosar, numeParte, dataStart, dataStop } = c.req.query();
  const institutii = c.req.queries("institutie") ?? [];

  if (!numarDosar && !obiectDosar && !numeParte) {
    return c.json({ error: "Cel putin un parametru este necesar: numarDosar, obiectDosar sau numeParte" }, 400);
  }

  // SECURITY: Cap institutii array to prevent request amplification
  if (institutii.length > MAX_INSTITUTII) {
    return c.json({ error: `Maxim ${MAX_INSTITUTII} institutii permise per cerere.` }, 400);
  }

  // SECURITY: defensive fanout cap mirrors the SSE /load-more guard.
  const fanout = Math.max(institutii.length, 1);
  if (fanout > MAX_SOAP_FANOUT) {
    return c.json(
      { error: `Cererea ar genera ${fanout} apeluri catre portal.just.ro. Maximum ${MAX_SOAP_FANOUT}.` },
      400
    );
  }

  for (const inst of institutii) {
    const instError = validateParams({ institutie: inst });
    if (instError) {
      return c.json({ error: instError }, 400);
    }
  }

  const validationError = validateParams({ numarDosar, obiectDosar, numeParte, dataStart, dataStop });
  if (validationError) {
    return c.json({ error: validationError }, 400);
  }

  // Client disconnect cancels in-flight SOAP — see routes/dosare.ts for rationale.
  const signal = c.req.raw.signal;

  try {
    let dosare: Awaited<ReturnType<typeof cautareDosare>>;
    if (institutii.length <= 1) {
      dosare = await cautareDosare(
        { numarDosar, obiectDosar, numeParte, institutie: institutii[0], dataStart, dataStop },
        { signal }
      );
    } else {
      const results = await Promise.all(
        institutii.map((inst) =>
          cautareDosare(
            { numarDosar, obiectDosar, numeParte, institutie: inst, dataStart, dataStop },
            { signal }
          ).catch((err) => {
            console.error(`Eroare cautare termene ${inst}:`, err);
            return [];
          })
        )
      );
      dosare = results.flat();
    }

    // SECURITY: cap dosare set before fanning out into termene (each dosar can
    // contain dozens of sedinte, so the termene array is even larger). Reject
    // before flatMap to avoid serializing tens of MB.
    if (dosare.length > MAX_DOSARE_RESPONSE) {
      return c.json(
        {
          error: `Rezultat prea mare (${dosare.length} dosare). Restrange filtrele sau intervalul (max ${MAX_DOSARE_RESPONSE}).`,
        },
        413
      );
    }

    // Extrage toate sedintele din toate dosarele (inclusiv parti si categorii)
    const termene = dosare.flatMap((d) =>
      d.sedinte.map((s) => ({
        numarDosar: d.numar,
        institutie: d.institutie,
        data: s.data,
        ora: s.ora,
        complet: s.complet,
        solutie: s.solutie,
        solutieSumar: s.solutieSumar,
        categorieCaz: d.categorieCaz,
        stadiuProcesual: d.stadiuProcesual,
        obiect: d.obiect,
        parti: d.parti,
      }))
    );

    // Sorteaza dupa data descrescator
    termene.sort((a, b) => (b.data ?? "").localeCompare(a.data ?? ""));

    return c.json({ data: termene, total: termene.length, dosareCount: dosare.length });
  } catch (err) {
    console.error("Eroare cautare termene:", err);
    return c.json({ error: "Eroare la comunicarea cu serviciul PortalJust. Incercati din nou." }, 500);
  }
});

// Load More Termene (SSE stream)
termeneRouter.post("/load-more", async (c) => {
  const { numarDosar, obiectDosar, numeParte, dataStart, dataStop } = c.req.query();
  const institutii = c.req.queries("institutie") ?? [];

  if (!numarDosar && !obiectDosar && !numeParte) {
    return c.json({ error: "Cel putin un parametru este necesar." }, 400);
  }

  if (institutii.length > MAX_INSTITUTII) {
    return c.json({ error: `Maxim ${MAX_INSTITUTII} institutii permise per cerere.` }, 400);
  }

  for (const inst of institutii) {
    const instError = validateParams({ institutie: inst });
    if (instError) {
      return c.json({ error: instError }, 400);
    }
  }

  const validationError = validateParams({ numarDosar, obiectDosar, numeParte, dataStart, dataStop });
  if (validationError) {
    return c.json({ error: validationError }, 400);
  }

  const range = dataStart && dataStop ? { dataStart, dataStop } : defaultDateRange();

  // SECURITY: Parse and validate existing dosare numbers from POST body
  const { set: existingNumere, error: bodyError } = await parseExistingFromBody(c);
  if (bodyError) {
    return c.json({ error: bodyError }, 400);
  }

  // SECURITY: Limit number of intervals to prevent resource exhaustion
  const intervals = generateMonthlyIntervals(range.dataStart, range.dataStop);
  if (intervals.length > MAX_SSE_INTERVALS) {
    return c.json(
      { error: `Intervalul de date este prea mare (${intervals.length} luni). Maximum ${MAX_SSE_INTERVALS} luni.` },
      400
    );
  }

  const institutionList: (string | undefined)[] = institutii.length > 0 ? institutii : [undefined];
  const totalUnits = institutionList.length * intervals.length;
  // SECURITY: bound upstream SOAP load per request so a single client cannot flood portal.just.ro
  if (totalUnits > MAX_SOAP_FANOUT) {
    return c.json(
      {
        error: `Cererea ar genera ${totalUnits} apeluri catre portal.just.ro. Maximum ${MAX_SOAP_FANOUT}. Restrange institutiile sau intervalul.`,
      },
      400
    );
  }

  const stream = new ReadableStream({
    async start(controller) {
      const abortController = new AbortController();
      const onAbort = () => abortController.abort();
      c.req.raw.signal?.addEventListener?.("abort", onAbort);

      // SECURITY: Abort stream after timeout — also triggers the in-flight batchFetchDosare to stop.
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        abortController.abort();
      }, SSE_TIMEOUT_MS);

      try {
        sseEvent(controller, "start", {
          range,
          intervals: totalUnits,
        });

        const allWarnings: string[] = [];
        let processedOffset = 0;
        let termeneCount = 0;

        for (const inst of institutionList) {
          if (abortController.signal.aborted) break;
          const params = { numarDosar, obiectDosar, numeParte, institutie: inst };
          const labelPrefix = inst ? `[${inst}] ` : "";

          const result = await batchFetchDosare(
            params,
            range,
            (processed, _total, _dosareFound, currentInterval) => {
              sseEvent(controller, "progress", {
                processed: processedOffset + processed,
                total: totalUnits,
                found: termeneCount,
                currentInterval: labelPrefix + currentInterval,
              });
            },
            (newItems) => {
              // Convert dosare batch → termene batch
              const termeneBatch = newItems.flatMap((d) =>
                d.sedinte.map((s) => ({
                  numarDosar: d.numar,
                  institutie: d.institutie,
                  data: s.data,
                  ora: s.ora,
                  complet: s.complet,
                  solutie: s.solutie,
                  solutieSumar: s.solutieSumar,
                  categorieCaz: d.categorieCaz,
                  stadiuProcesual: d.stadiuProcesual,
                  obiect: d.obiect,
                  parti: d.parti,
                }))
              );
              termeneCount += termeneBatch.length;
              // Cross-institutie dedup at the dosar level — same dosar across courts streamed only once.
              for (const item of newItems) existingNumere.add(item.numar);
              // Send in chunks of 50 to avoid large SSE events getting lost in proxy buffers
              for (let i = 0; i < termeneBatch.length; i += 50) {
                const chunk = termeneBatch.slice(i, i + 50);
                sseEvent(controller, "batch", { data: chunk, count: chunk.length });
              }
            },
            existingNumere,
            abortController.signal
          );

          allWarnings.push(...result.warnings);
          processedOffset += intervals.length;
        }

        if (timedOut) {
          sseEvent(controller, "error", { error: "Timeout — cautarea extinsa a depasit limita de timp." });
        } else if (!abortController.signal.aborted) {
          sseEvent(controller, "done", {
            total: termeneCount,
            warnings: allWarnings,
          });
        }
      } catch (err) {
        if (!abortController.signal.aborted) {
          console.error("Eroare load-more termene:", err);
          sseEvent(controller, "error", { error: "Eroare la incarcarea extinsa." });
        }
      } finally {
        clearTimeout(timeout);
        c.req.raw.signal?.removeEventListener?.("abort", onAbort);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

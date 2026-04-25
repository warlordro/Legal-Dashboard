import { Hono } from "hono";
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
import {
  batchFetchDosare,
  parseExistingFromBody,
  sseEvent,
} from "../services/batch-dosare.ts";

export const dosareRouter = new Hono();

// Cautare dosare (cu sedinte incluse)
dosareRouter.get("/", async (c) => {
  const { numarDosar, obiectDosar, numeParte, dataStart, dataStop } = c.req.query();
  const institutii = c.req.queries("institutie") ?? [];

  if (!numarDosar && !obiectDosar && !numeParte) {
    return c.json(
      { error: "Cel putin un parametru este necesar: numarDosar, obiectDosar sau numeParte" },
      400
    );
  }

  // SECURITY: Cap institutii array to prevent request amplification
  if (institutii.length > MAX_INSTITUTII) {
    return c.json({ error: `Maxim ${MAX_INSTITUTII} institutii permise per cerere.` }, 400);
  }

  // SECURITY: defensive fanout cap mirrors the SSE /load-more guard. Today
  // institutii.length is already capped by MAX_INSTITUTII, but if either limit
  // shifts in the future this keeps a hard upper bound on upstream SOAP calls.
  const fanout = Math.max(institutii.length, 1);
  if (fanout > MAX_SOAP_FANOUT) {
    return c.json({ error: `Cererea ar genera ${fanout} apeluri catre portal.just.ro. Maximum ${MAX_SOAP_FANOUT}.` }, 400);
  }

  // Validate all institutie values (not just the first)
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

  try {
    let dosare;
    if (institutii.length <= 1) {
      dosare = await cautareDosare({ numarDosar, obiectDosar, numeParte, institutie: institutii[0], dataStart, dataStop });
    } else {
      // Parallel SOAP calls for multiple institutions
      const results = await Promise.all(
        institutii.map((inst) =>
          cautareDosare({ numarDosar, obiectDosar, numeParte, institutie: inst, dataStart, dataStop })
            .catch((err) => { console.error(`Eroare cautare ${inst}:`, err); return []; })
        )
      );
      dosare = results.flat();
    }
    // SECURITY: cap response size before JSON.stringify. Each dosar carries
    // parti + sedinte arrays; an aggregate of >MAX_DOSARE_RESPONSE explodes
    // memory and stalls the event loop on serialization. Reject loudly with
    // 413 so the client narrows filters rather than silently truncating.
    if (dosare.length > MAX_DOSARE_RESPONSE) {
      return c.json({ error: `Rezultat prea mare (${dosare.length} dosare). Restrange filtrele sau intervalul (max ${MAX_DOSARE_RESPONSE}).` }, 413);
    }
    return c.json({ data: dosare, total: dosare.length });
  } catch (err) {
    console.error("Eroare cautare dosare:", err);
    return c.json({ error: "Eroare la comunicarea cu serviciul PortalJust. Incercati din nou." }, 500);
  }
});

// Load More Dosare (SSE stream)
dosareRouter.post("/load-more", async (c) => {
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

  // Determine date range
  const range = (dataStart && dataStop)
    ? { dataStart, dataStop }
    : defaultDateRange();

  // SECURITY: Parse and validate existing dosare numbers from POST body
  const { set: existingNumere, error: bodyError } = await parseExistingFromBody(c);
  if (bodyError) {
    return c.json({ error: bodyError }, 400);
  }

  // SECURITY: Limit number of intervals to prevent resource exhaustion
  const intervals = generateMonthlyIntervals(range.dataStart, range.dataStop);
  if (intervals.length > MAX_SSE_INTERVALS) {
    return c.json({ error: `Intervalul de date este prea mare (${intervals.length} luni). Maximum ${MAX_SSE_INTERVALS} luni.` }, 400);
  }

  // Iterate per institutie so the search uses the SAME set the user picked, not just the first.
  // Single sweep when no institutie filter (institutionList = [undefined]).
  const institutionList: (string | undefined)[] = institutii.length > 0 ? institutii : [undefined];
  const totalUnits = institutionList.length * intervals.length;
  // SECURITY: bound upstream SOAP load per request so a single client cannot flood portal.just.ro
  if (totalUnits > MAX_SOAP_FANOUT) {
    return c.json({ error: `Cererea ar genera ${totalUnits} apeluri catre portal.just.ro. Maximum ${MAX_SOAP_FANOUT}. Restrange institutiile sau intervalul.` }, 400);
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
        let totalNew = 0;

        for (const inst of institutionList) {
          if (abortController.signal.aborted) break;
          const params = { numarDosar, obiectDosar, numeParte, institutie: inst };
          const labelPrefix = inst ? `[${inst}] ` : "";

          const result = await batchFetchDosare(params, range,
            (processed, _total, foundInThisInst, currentInterval) => {
              sseEvent(controller, "progress", {
                processed: processedOffset + processed,
                total: totalUnits,
                found: totalNew + foundInThisInst,
                currentInterval: labelPrefix + currentInterval,
              });
            },
            (newItems) => {
              // Send in chunks of 50 to avoid large SSE events getting lost in proxy buffers
              for (let i = 0; i < newItems.length; i += 50) {
                const chunk = newItems.slice(i, i + 50);
                sseEvent(controller, "batch", { data: chunk, count: chunk.length });
              }
              // Cross-institutie dedup: subsequent institutii skip dosare already streamed.
              for (const item of newItems) existingNumere.add(item.numar);
            },
            existingNumere,
            abortController.signal,
          );

          allWarnings.push(...result.warnings);
          processedOffset += intervals.length;
          totalNew += result.items.length;
        }

        if (timedOut) {
          sseEvent(controller, "error", { error: "Timeout — cautarea extinsa a depasit limita de timp." });
        } else if (!abortController.signal.aborted) {
          sseEvent(controller, "done", {
            total: totalNew,
            warnings: allWarnings,
          });
        }
      } catch (err) {
        if (!abortController.signal.aborted) {
          console.error("Eroare load-more dosare:", err);
          sseEvent(controller, "error", { error: "Eroare la incarcarea extinsa." });
        }
      } finally {
        clearTimeout(timeout);
        c.req.raw.signal?.removeEventListener?.("abort", onAbort);
        try { controller.close(); } catch { /* already closed */ }
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

import { Hono } from "hono";
import {
  fetchIccjDetail,
  IccjParseError,
  IccjSourceError,
  searchIccjEnriched,
  searchTermeneByDosarIccj,
} from "../services/iccj/iccjClient.ts";
import { ICCJ_SECTII_IDS } from "../services/iccj/iccjSectiiIds.ts";
import { isValidDate } from "../util/validation.ts";

// ICCJ (Inalta Curte) live-proxy search. Mounted at /api/dosare-iccj, so it
// inherits the global middleware chain (preAuthRateLimit -> ownerContext ->
// rateLimit -> originGuard); in web mode ownerContext fails closed, satisfying
// the "authenticated like the rest of the API" requirement (Codex #9).
export const dosareIccjRouter = new Hono();

// Operational kill switch for the INTERACTIVE ICCJ routes (separate from the
// scheduler's MONITORING_DISABLED_KINDS, which only stops monitoring claims). Lets ops
// stop user-initiated scraping without a redeploy if scj.ro blocks the IP / rate-limits.
function iccjRoutesDisabled(): boolean {
  return process.env.ICCJ_ROUTES_DISABLED === "1";
}
const ICCJ_DISABLED_BODY = {
  error: "Cautarea ICCJ (scj.ro) este dezactivata temporar de catre administrator.",
  // v2.37.1: cod programatic ca UI-ul sa poata distinge "dezactivat deliberat"
  // de un 5xx generic retryabil.
  code: "ICCJ_DISABLED",
} as const;
const ICCJ_DISABLED_HEADERS = { "Retry-After": "300" } as const;
dosareIccjRouter.use("*", async (c, next) => {
  if (iccjRoutesDisabled()) return c.json(ICCJ_DISABLED_BODY, 503, ICCJ_DISABLED_HEADERS);
  await next();
});

const MAX_FIELD = 200;

function tooLong(v: string | undefined): boolean {
  return !!v && v.length > MAX_FIELD;
}

// Reject a present-but-non-ISO date: it would otherwise be forwarded to scj.ro (dosare)
// or used in a lexicographic range filter (termene) where a junk value matches everything.
// v2.37.1: isValidDate respinge si datele calendaristic imposibile (2026-02-31),
// nu doar formatul gresit — aliniat cu rutele PortalJust.
function badDate(v: string | undefined): boolean {
  return !!v && !isValidDate(v);
}

// v2.37.1: sectie validata contra id-urilor Department cunoscute, nu doar
// length-capped — junk-ul forwardat la scj.ro producea un credibil "0 rezultate".
function badSectie(v: string | undefined): boolean {
  return v !== undefined && !ICCJ_SECTII_IDS.has(v);
}

function mapError(err: unknown): { status: 502 | 504 | 500; message: string } {
  if (err instanceof IccjSourceError) {
    return { status: 502, message: "Serviciul ICCJ (scj.ro) nu a raspuns corect. Incercati din nou." };
  }
  if (err instanceof IccjParseError) {
    return { status: 502, message: "Raspuns neasteptat de la ICCJ (scj.ro). Reincercati mai tarziu." };
  }
  // v2.37.1: expirarea ICCJ_TIMEOUT_MS (AbortSignal.timeout -> DOMException
  // TimeoutError) e o problema de upstream lent, nu o eroare interna => 504.
  if (err instanceof DOMException && err.name === "TimeoutError") {
    return { status: 504, message: "Serviciul ICCJ (scj.ro) nu a raspuns in timp util. Incercati din nou." };
  }
  return { status: 500, message: "Eroare la comunicarea cu ICCJ." };
}

// GET /api/dosare-iccj?numarDosar=&obiectDosar=&numeParte=&sectie=&dataStart=&dataStop=&page=
dosareIccjRouter.get("/", async (c) => {
  const { numarDosar, obiectDosar, numeParte, sectie, dataStart, dataStop, page } = c.req.query();

  if (!numarDosar && !obiectDosar && !numeParte && !dataStart) {
    return c.json(
      { error: "Cel putin un parametru este necesar: numarDosar, obiectDosar, numeParte sau dataStart." },
      400
    );
  }
  if (tooLong(numarDosar) || tooLong(obiectDosar) || tooLong(numeParte) || tooLong(sectie)) {
    return c.json({ error: `Parametrii de cautare nu pot depasi ${MAX_FIELD} caractere.` }, 400);
  }
  if (badDate(dataStart) || badDate(dataStop)) {
    return c.json({ error: "Data trebuie sa fie o data calendaristica valida in format YYYY-MM-DD." }, 400);
  }
  if (badSectie(sectie)) {
    return c.json({ error: "Sectie necunoscuta." }, 400);
  }
  const pageNum = page ? Number.parseInt(page, 10) : 1;
  if (!Number.isFinite(pageNum) || pageNum < 1 || pageNum > 20) {
    return c.json({ error: "Pagina invalida (1-20)." }, 400);
  }

  try {
    // Enriched server-side: each dosar's /1094 detail (categorie + party roles + sedinte)
    // is fetched and merged before responding, so the client receives complete dosare with
    // no separate enrichment step/UI. Slower for broad result pages, bounded by concurrency.
    const result = await searchIccjEnriched(
      { numarDosar, obiectDosar, numeParte, sectie, dataStart, dataStop },
      { signal: c.req.raw.signal, page: pageNum }
    );
    // No `hasMore`: the frontend derives it from cumulative loaded count vs `total`
    // (a fixed page-size guess was wrong on partial last pages). See IccjSearchResult.
    return c.json({
      data: result.dosare,
      total: result.total,
      page: result.page,
    });
  } catch (err) {
    // Client plecat (abort) => nu e o eroare de upstream; nu polua stderr.
    if (!c.req.raw.signal.aborted) console.error("Eroare cautare ICCJ:", err);
    const { status, message } = mapError(err);
    return c.json({ error: message }, status);
  }
});

// GET /api/dosare-iccj/detaliu/:id — full detail (lazy). :id is numeric-only
// (Codex #9): never forward an arbitrary id to the upstream detail page.
dosareIccjRouter.get("/detaliu/:id", async (c) => {
  const id = c.req.param("id");
  if (!/^\d{1,20}$/.test(id)) {
    return c.json({ error: "Id dosar invalid." }, 400);
  }
  try {
    const dosar = await fetchIccjDetail(id, { signal: c.req.raw.signal });
    return c.json({ data: dosar });
  } catch (err) {
    if (!c.req.raw.signal.aborted) console.error("Eroare detaliu ICCJ:", err);
    const { status, message } = mapError(err);
    return c.json({ error: message }, status);
  }
});

// ICCJ termene — mounted at /api/termene-iccj. Same middleware chain.
export const termeneIccjRouter = new Hono();
termeneIccjRouter.use("*", async (c, next) => {
  if (iccjRoutesDisabled()) return c.json(ICCJ_DISABLED_BODY, 503, ICCJ_DISABLED_HEADERS);
  await next();
});

// GET /api/termene-iccj?numarDosar=&numeParte=&obiectDosar=&sectie=&dataStart=&dataStop=
// Searches ICCJ dosare (by numar / parte / obiect / sectie) and returns ALL their
// termene (sedinte), so the user sees every date a case appeared or will appear.
// No date required. dataStart/dataStop (ISO) are OPTIONAL filters on the hearing
// date applied to the flattened result.
termeneIccjRouter.get("/", async (c) => {
  const { numarDosar, numeParte, obiectDosar, sectie, dataStart, dataStop } = c.req.query();
  if (!numarDosar?.trim() && !numeParte?.trim() && !obiectDosar?.trim()) {
    return c.json(
      { error: "Introduceti un numar de dosar, nume parte sau obiect pentru a vedea termenele ICCJ." },
      400
    );
  }
  if (tooLong(numarDosar) || tooLong(numeParte) || tooLong(obiectDosar) || tooLong(sectie)) {
    return c.json({ error: `Parametrii nu pot depasi ${MAX_FIELD} caractere.` }, 400);
  }
  if (badDate(dataStart) || badDate(dataStop)) {
    return c.json({ error: "Data trebuie sa fie o data calendaristica valida in format YYYY-MM-DD." }, 400);
  }
  if (badSectie(sectie)) {
    return c.json({ error: "Sectie necunoscuta." }, 400);
  }
  try {
    const res = await searchTermeneByDosarIccj(
      { numarDosar, numeParte, obiectDosar, sectie },
      { signal: c.req.raw.signal }
    );
    let termene = res.termene;
    // Optional date-range filter on the hearing date. termen.data is ISO (YYYY-MM-DD)
    // and dataStart/dataStop arrive ISO from the date input, so string compare is safe.
    if (dataStart) termene = termene.filter((t) => !t.data || t.data >= dataStart);
    if (dataStop) termene = termene.filter((t) => !t.data || t.data <= dataStop);
    return c.json({
      data: termene,
      total: termene.length,
      dosareCount: res.dosareCount,
      truncated: res.truncated,
    });
  } catch (err) {
    if (!c.req.raw.signal.aborted) console.error("Eroare termene ICCJ:", err);
    const { status, message } = mapError(err);
    return c.json({ error: message }, status);
  }
});

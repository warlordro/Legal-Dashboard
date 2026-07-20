// ICCJ (Inalta Curte de Casatie si Justitie) live-proxy client.
//
// Mirrors backend/src/soap.ts (PortalJust) but for the ICCJ website search at
// www.scj.ro. Unlike portalquery.just.ro (SOAP/XML), ICCJ exposes no public
// JSON web service in practice (the documented api.scj.ro:97 is time-windowed
// 3:30-6:30 AM and unconfirmed live), so we proxy the website search form on
// /738, which returns a JSON envelope whose `Items` field is an HTML table-rows
// STRING. We parse that HTML, and fetch the per-dosar detail page (/1094) lazily
// for full parti/sedinte/cai-atac data.
//
// Empirically verified 2026-06-06 (see PLAN-iccj-integration.md):
//   - search works during the day (no time window), HTTPS, no captcha
//   - a plain POST returns results; no session cookie or CSRF token is required.
//     A cold IP can occasionally get a transient FALSE empty
//     ({"Items":null,"Keywords":"Nu sunt rezultate."}), so we do a best-effort
//     warm-up GET (capturing any cookie) and retry once on an ambiguous empty.
//   - results are sorted date-DESC and paginated (?page=N), ~50/page, cap 1000.

import { readResponseTextWithCap, ResponseTooLargeSignal } from "../../util/streamCap.ts";
import { type IccjCaller, withBreaker } from "./iccjBreaker.ts";

const ICCJ_ORIGIN = "https://www.scj.ro";
const SEARCH_PAGE = `${ICCJ_ORIGIN}/738/Cautare-dosare-si-parti`;
// POST target — the CMS form action is the (url-encoded) Romanian page path.
const SEARCH_ACTION = `${ICCJ_ORIGIN}/738/C%C4%83utare%20dosare%20%C5%9Fi%20p%C4%83r%C5%A3i`;
const DETAIL_URL = `${ICCJ_ORIGIN}/1094/Detalii-dosar`;
// Sedinte (hearings) search — /737. Same CMS form mechanism as /738; searches by
// date (StartDate/EndDate) + optional Department (sectie). Returns one outer <tr>
// per hearing (complet sitting), each containing an inner table of dosare.
const SEDINTE_PAGE = `${ICCJ_ORIGIN}/737/Cautare-sedinte-de-judecata`;
const SEDINTE_ACTION = `${ICCJ_ORIGIN}/737/C%C4%83utare%20%C5%9Fedin%C5%A3e%20de%20judecat%C4%83`;

// Env-tunable so ops can throttle without a redeploy if scj.ro slows / rate-limits.
function envPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
const ICCJ_TIMEOUT_MS = envPositiveInt("ICCJ_TIMEOUT_MS", 30_000);
// HTML pages are larger than SOAP XML per-dosar; 20MB caps a single search page
// (~50 dosare summary) or one detail page with hundreds of parti/sedinte.
const ICCJ_MAX_RESPONSE_BYTES = envPositiveInt("ICCJ_MAX_RESPONSE_BYTES", 20 * 1024 * 1024);
// Aggregate wall-clock budget for the server-side enrich loop (searchIccjEnriched).
// Bounds total latency below typical reverse-proxy timeouts; rows not reached by the
// deadline are returned un-enriched (graceful degradation), never an error.
const ICCJ_ENRICH_BUDGET_MS = envPositiveInt("ICCJ_ENRICH_BUDGET_MS", 45_000);
// Session cookie TTL. The ASP.NET session lives much longer, but we refresh
// defensively so a long-lived backend process never relies on a stale cookie.
const SESSION_TTL_MS = 10 * 60 * 1000;
// ICCJ is a single institution — surfaced as the `institutie` field so the
// existing DosareTable renders it uniformly with PortalJust rows.
export const ICCJ_INSTITUTIE = "Inalta Curte de Casatie si Justitie";

export interface IccjSearchParams {
  numarDosar?: string;
  obiectDosar?: string;
  numeParte?: string;
  // Department id from frontend/src/lib/iccjSectii.ts (e.g. "157"); "" = all.
  sectie?: string;
  dataStart?: string;
  dataStop?: string;
}

export interface IccjDosarParte {
  nume: string;
  calitateParte: string;
}

export interface IccjDosarSedinta {
  complet: string;
  data: string;
  ora: string;
  solutie: string;
  solutieSumar: string;
  documentSedinta: string;
  numarDocument: string;
  dataPronuntare: string;
}

export interface IccjCaleAtac {
  dataDeclarare: string;
  tipCaleAtac: string;
  parteDeclaratoare: string;
}

// Structurally compatible with the frontend Dosar (same field names) plus
// ICCJ-only optional fields. `source`/`iccjId` let the UI badge + lazy-fetch.
export interface IccjDosar {
  numar: string;
  data: string;
  institutie: string;
  departament: string;
  obiect: string;
  categorieCaz: string;
  stadiuProcesual: string;
  parti: IccjDosarParte[];
  sedinte: IccjDosarSedinta[];
  source: "iccj";
  iccjId: string;
  numarVechi?: string;
  dataInitiala?: string;
  stadiulProcesualCombinat?: string;
  obiecteSecundare?: string;
  caiAtac?: IccjCaleAtac[];
}

export interface IccjSearchResult {
  dosare: IccjDosar[];
  total: number; // server-reported match count (json.Keywords, "N rezultate")
  page: number;
  // No `hasMore`: the upstream page size is not something we control or reliably
  // know per stateless call, so guessing it (old `page * 50 < total`) was wrong on
  // partial last pages. Callers decide "are there more" from cumulative state:
  // frontend uses `loadedSoFar < total` (+ stop on a page that adds zero new rows);
  // termene uses `total > dosare.length` (it only fetches page 1).
}

// One row per (hearing × dosar). Structurally compatible with the frontend
// Termen (numarDosar, institutie, data, ora, complet, solutie, ...).
export interface IccjTermen {
  numarDosar: string;
  iccjId: string;
  institutie: string;
  data: string; // ISO
  ora: string;
  complet: string;
  solutie: string;
  solutieSumar: string;
  categorieCaz: string; // sectia (folosita ca eticheta de categorie in UI)
  stadiuProcesual: string;
  parti: IccjDosarParte[];
  source: "iccj";
}

export interface IccjSedinteParams {
  data: string; // ISO or DD.MM.YYYY
  dataStop?: string;
  sectie?: string; // Department id; "" = all
}

export interface IccjRequestOptions {
  signal?: AbortSignal;
  page?: number;
  // Clasa de apelant pentru circuit-breaker-ul global (piesa A). Default "ui".
  // Rutele PAT paseaza "pat" (pondere mica); iccjRunner (monitoring) paseaza "monitoring".
  callerClass?: IccjCaller;
}

// Source/markup failures MUST NOT be confused with "0 results" — otherwise
// monitoring would emit false `dosar_disappeared` alerts (Codex review #3).
export class IccjSourceError extends Error {
  readonly code = "ICCJ_SOURCE_ERROR";
  constructor(reason: string) {
    super(`ICCJ source error: ${reason}`);
    this.name = "IccjSourceError";
  }
}

export class IccjParseError extends Error {
  readonly code = "ICCJ_PARSE_ERROR";
  constructor(reason: string) {
    super(`ICCJ parse error: ${reason}`);
    this.name = "IccjParseError";
  }
}

// ── HTML helpers ──────────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  raquo: "»",
  laquo: "«",
  rarr: "→",
  larr: "←",
};

export function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? m);
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function stripComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, "");
}

// ICCJ surfaces dates as DD.MM.YYYY; the rest of the app (date sort, formatDate,
// monitoring notify_days_before arithmetic) treats Dosar dates as ISO. Normalize
// at the ingestion boundary so every consumer works without per-site patches.
// Non-matching strings (empty, already-ISO, "-") pass through unchanged.
export function iccjDateToIso(s: string): string {
  const m = s.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
}

// Reverse: ISO (from a <input type=date>) -> DD.MM.YYYY for the scj.ro request.
// Passes through anything that isn't ISO (e.g. already DD.MM.YYYY).
export function isoToIccjDate(s: string): string {
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
}

function matchAll(html: string, re: RegExp): string[] {
  return Array.from(html.matchAll(re), (m) => m[1]);
}

// ── Search-results (Items HTML) parser ────────────────────────────────────

// Parse the `<tr>` rows from the search envelope's `Items` HTML string into
// summary dosare. Validates per-row invariants (Codex #4): a row must yield an
// internal id + a docket number, else the markup drifted -> IccjParseError.
export function parseSearchItems(itemsHtml: string): IccjDosar[] {
  const rows = matchAll(itemsHtml, /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi);
  const out: IccjDosar[] = [];
  for (const row of rows) {
    const cells = matchAll(row, /<td\b[^>]*>([\s\S]*?)<\/td>/gi);
    // Columns: index, link(numar+id), data, obiect, stadiu, departament, parti
    if (cells.length < 7) {
      throw new IccjParseError(`row has ${cells.length} cells, expected >= 7`);
    }
    const linkCell = cells[1];
    const iccjId = linkCell.match(/[Vv]alue=(\d+)/)?.[1] ?? "";
    const numar = stripTags(linkCell.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? "");
    if (!iccjId || !numar) {
      throw new IccjParseError("row missing iccjId or numar (markup drift?)");
    }
    const parti = matchAll(cells[6], /<li\b[^>]*>([\s\S]*?)<\/li>/gi)
      .map((li) => ({ nume: stripTags(li), calitateParte: "" }))
      .filter((p) => p.nume.length > 0);
    out.push({
      numar,
      iccjId,
      data: iccjDateToIso(stripTags(cells[2])),
      obiect: stripTags(cells[3]),
      stadiuProcesual: stripTags(cells[4]),
      departament: stripTags(cells[5]),
      institutie: ICCJ_INSTITUTIE,
      categorieCaz: "",
      parti,
      sedinte: [],
      source: "iccj",
    });
  }
  return out;
}

// ── Detail page (/1094) parser ────────────────────────────────────────────

function dlPairs(html: string): Array<{ label: string; dd: string }> {
  const clean = stripComments(html);
  const dl = clean.match(/<dl[^>]*class="[^"]*docket_details[^"]*"[^>]*>([\s\S]*?)<\/dl>/i)?.[1];
  if (!dl) return [];
  const pairs: Array<{ label: string; dd: string }> = [];
  const re = /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi;
  for (const m of dl.matchAll(re)) {
    pairs.push({ label: stripTags(m[1]).replace(/:$/, "").trim(), dd: m[2] });
  }
  return pairs;
}

function normLabel(s: string): string {
  return (
    s
      .normalize("NFD")
      // biome-ignore lint/suspicious/noMisleadingCharacterClass: combining marks range after NFD
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim()
      .replace(/:$/, "")
  );
}

const DASH = "-";
function valOrEmpty(s: string): string {
  const t = stripTags(s);
  return t === DASH ? "" : t;
}

// Parse the parti `<li>` items: "NUME - Calitate" with an optional trailing
// "<p>Data emiterii ultimei comunicari ...</p>".
function parseDetailParti(dd: string): IccjDosarParte[] {
  return matchAll(dd, /<li\b[^>]*>([\s\S]*?)<\/li>/gi)
    .map((li) => {
      const text = stripTags(li.replace(/<p\b[^>]*>[\s\S]*?<\/p>/gi, ""));
      const idx = text.lastIndexOf(" - ");
      if (idx === -1) return { nume: text, calitateParte: "" };
      return { nume: text.slice(0, idx).trim(), calitateParte: text.slice(idx + 3).trim() };
    })
    .filter((p) => p.nume.length > 0);
}

// Parse the sedinte/termene <table> rows. Each <tr>: td0=data, td1=ora,
// td2=<ul> of "<li><strong>label: </strong>value</li>".
export function parseDetailSedinte(dd: string): IccjDosarSedinta[] {
  const tbody = dd.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i)?.[1];
  if (!tbody) {
    // A <table> present without a parseable <tbody> = markup drift, NOT a genuine
    // "no hearings". Fail loud (Codex F5) so monitoring records an error instead of
    // writing a "present, zero sedinte" snapshot that erases prior hearing state.
    if (/<table\b/i.test(dd)) throw new IccjParseError("sedinte: <table> present without <tbody> (markup drift)");
    return [];
  }
  const out: IccjDosarSedinta[] = [];
  for (const row of matchAll(tbody, /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = matchAll(row, /<td\b[^>]*>([\s\S]*?)<\/td>/gi);
    if (cells.length < 3) continue;
    const fields: Record<string, string> = {};
    for (const li of matchAll(cells[2], /<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
      const label = normLabel(stripTags(li.match(/<strong\b[^>]*>([\s\S]*?)<\/strong>/i)?.[1] ?? ""));
      const value = stripTags(li.replace(/<strong\b[^>]*>[\s\S]*?<\/strong>/i, ""));
      if (label) fields[label] = value === DASH ? "" : value;
    }
    out.push({
      data: iccjDateToIso(stripTags(cells[0])),
      ora: stripTags(cells[1]),
      complet: fields[normLabel("Complet de judecata")] ?? "",
      numarDocument: fields[normLabel("Numarul documentului de solutionare")] ?? "",
      dataPronuntare: iccjDateToIso(fields[normLabel("Data documentului de solutionare")] ?? ""),
      documentSedinta: fields[normLabel("Tipul documentului de solutionare")] ?? "",
      solutie: fields[normLabel("Solutie")] ?? "",
      solutieSumar: fields[normLabel("Detalii solutie")] ?? "",
    });
  }
  return out;
}

// Parse the cai-de-atac <table>: td0=dataDeclarare, td1=tip, td2=parte.
function parseDetailCaiAtac(dd: string): IccjCaleAtac[] {
  const tbody = dd.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i)?.[1];
  if (!tbody) return [];
  const out: IccjCaleAtac[] = [];
  for (const row of matchAll(tbody, /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = matchAll(row, /<td\b[^>]*>([\s\S]*?)<\/td>/gi);
    if (cells.length < 3) continue;
    out.push({
      dataDeclarare: iccjDateToIso(stripTags(cells[0])),
      tipCaleAtac: stripTags(cells[1]),
      parteDeclaratoare: stripTags(cells[2]),
    });
  }
  return out;
}

// Parse the full detail page into a Dosar. `iccjId` is supplied by the caller
// (it is the id used to fetch the page); `numar` is validated against the page.
export function parseDetail(html: string, iccjId: string): IccjDosar {
  const pairs = dlPairs(html);
  if (pairs.length === 0) {
    throw new IccjParseError("detail page has no docket_details dl (markup drift?)");
  }
  const get = (labelRo: string): string | undefined => {
    const want = normLabel(labelRo);
    return pairs.find((p) => normLabel(p.label).startsWith(want))?.dd;
  };

  const numarDd = get("Numarul dosarului");
  const numar = numarDd ? stripTags(numarDd) : "";
  if (!numar) {
    throw new IccjParseError("detail page missing 'Numarul dosarului'");
  }

  const partiDd = get("Partile din dosar") ?? "";
  const sedinteDd = get("Sedinte de judecata") ?? "";
  const caiAtacDd = get("Cai de atac") ?? "";

  const numarVechi = valOrEmpty(get("Numarul vechi al dosarului") ?? "");
  const dataInitiala = iccjDateToIso(valOrEmpty(get("Data initiala a dosarului") ?? ""));
  const stadiulProcesualCombinat = valOrEmpty(get("Stadiul procesual combinat") ?? "");
  const obiecteSecundare = valOrEmpty(get("Obiectele secundare ale dosarului") ?? "");
  const caiAtac = parseDetailCaiAtac(caiAtacDd);

  return {
    numar,
    iccjId,
    institutie: ICCJ_INSTITUTIE,
    data: iccjDateToIso(stripTags(get("Data formarii dosarului la ICCJ") ?? "")),
    departament: stripTags(get("Sectie") ?? ""),
    categorieCaz: stripTags(get("Materia juridica") ?? ""),
    obiect: stripTags(get("Obiectul dosarului") ?? ""),
    stadiuProcesual: stripTags(get("Stadiul procesual") ?? ""),
    parti: parseDetailParti(partiDd),
    sedinte: parseDetailSedinte(sedinteDd),
    source: "iccj",
    ...(numarVechi ? { numarVechi } : {}),
    ...(dataInitiala ? { dataInitiala } : {}),
    ...(stadiulProcesualCombinat ? { stadiulProcesualCombinat } : {}),
    ...(obiecteSecundare ? { obiecteSecundare } : {}),
    ...(caiAtac.length ? { caiAtac } : {}),
  };
}

// ── Response classification (false-empty guard, Codex #3) ─────────────────

type Classification = "results" | "empty" | "error";

interface IccjEnvelope {
  Keywords?: unknown;
  Items?: unknown;
  Status?: unknown;
}

// Parse the upstream "N rezultate" count. Tolerant of: localized thousands separators
// (`1.234`, `1 234`, nbsp) and the singular/plural token (`rezultat`/`rezultate` — scj.ro
// uses an ungrammatical plural even for 1, but we accept either). Returns null when the
// Keywords string isn't a result-count line (→ caller treats as not-"results").
export function parseResultCount(kw: string): number | null {
  const m = kw.match(/^([\d.  ]+?)\s+rezultat/i);
  if (!m) return null;
  const digits = m[1].replace(/\D/g, "");
  return digits ? Number.parseInt(digits, 10) : null;
}

export function classifyEnvelope(json: IccjEnvelope): Classification {
  if (!json || json.Status !== 1) return "error";
  const kw = typeof json.Keywords === "string" ? json.Keywords : "";
  if (json.Items === null || json.Items === undefined) {
    // True empty ONLY with the exact known marker; anything else = source error
    // (e.g. an anti-bot/redirect body that happens to lack Items).
    return kw === "Nu sunt rezultate." ? "empty" : "error";
  }
  if (typeof json.Items === "string" && parseResultCount(kw) !== null) return "results";
  return "error";
}

// ── Network ───────────────────────────────────────────────────────────────

function combineSignals(external?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(ICCJ_TIMEOUT_MS);
  return external ? AbortSignal.any([external, timeout]) : timeout;
}

let cachedCookie: { value: string; expiresAt: number } | null = null;
// Single-flight guard: when a batch of concurrent detail fetches all hit an expired
// session at once, they must share ONE warm-up GET, not fire one each (thundering herd
// against a fragile gov site). Holds the in-flight warmSession promise while it runs.
let inflightWarm: Promise<string> | null = null;

export function _resetSessionForTests(): void {
  cachedCookie = null;
  inflightWarm = null;
}

// Best-effort warm-up: GET the search page so the upstream establishes whatever
// per-IP/session affinity it wants, and capture any Set-Cookie. The POST works
// cookieless too (verified 2026-06-06), so this NEVER throws on a missing
// cookie — it only returns whatever cookie string it could collect ("" if none).
async function warmSession(signal: AbortSignal): Promise<string> {
  try {
    const res = await fetch(SEARCH_PAGE, {
      method: "GET",
      headers: { "User-Agent": "Mozilla/5.0 (LegalDashboard ICCJ proxy)" },
      signal,
    });
    await readResponseTextWithCap(res, ICCJ_MAX_RESPONSE_BYTES, signal).catch(() => "");
    const setCookies =
      typeof res.headers.getSetCookie === "function"
        ? res.headers.getSetCookie()
        : (res.headers.get("set-cookie") ?? "").split(/,(?=[^;]+=)/);
    return setCookies
      .map((c) => c.split(";")[0].trim())
      .filter(Boolean)
      .join("; ");
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return "";
  }
}

async function getSession(signal: AbortSignal, forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedCookie && cachedCookie.expiresAt > Date.now()) {
    return cachedCookie.value;
  }
  // Coalesce concurrent (re)warms into one upstream GET.
  if (!inflightWarm) {
    inflightWarm = warmSession(signal)
      .then((value) => {
        cachedCookie = { value, expiresAt: Date.now() + SESSION_TTL_MS };
        return value;
      })
      .finally(() => {
        inflightWarm = null;
      });
  }
  return inflightWarm;
}

export function buildSearchBody(params: IccjSearchParams): string {
  const body = new URLSearchParams();
  body.set("formTypeId", "6");
  body.set("websiteId", "0");
  const pairs: Array<[string, string]> = [
    ["DocketObject", params.obiectDosar ?? ""],
    ["Department", params.sectie ?? ""],
    ["DocketNumber", params.numarDosar ?? ""],
    ["PartyName", params.numeParte ?? ""],
    // scj.ro expects DD.MM.YYYY; the <input type=date> sends ISO. Convert (the /737
    // sedinte path already does this) — otherwise the date filter is silently ignored.
    ["StartDate", isoToIccjDate(params.dataStart ?? "")],
    ["EndDate", isoToIccjDate(params.dataStop ?? "")],
  ];
  pairs.forEach(([key, value], i) => {
    body.set(`CustomQuery[${i}].Key`, key);
    body.set(`CustomQuery[${i}].Value`, value);
  });
  return body.toString();
}

async function postSearch(
  params: IccjSearchParams,
  page: number,
  cookie: string,
  signal: AbortSignal
): Promise<IccjEnvelope> {
  const url = page > 1 ? `${SEARCH_ACTION}?page=${page}` : SEARCH_ACTION;
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    "X-Requested-With": "XMLHttpRequest",
    Referer: SEARCH_PAGE,
    "User-Agent": "Mozilla/5.0 (LegalDashboard ICCJ proxy)",
  };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(url, { method: "POST", headers, body: buildSearchBody(params), signal });
  let text: string;
  try {
    text = await readResponseTextWithCap(res, ICCJ_MAX_RESPONSE_BYTES, signal);
  } catch (err) {
    if (err instanceof ResponseTooLargeSignal) throw new IccjSourceError(`response too large (${err.bytes})`);
    throw err;
  }
  if (!res.ok) throw new IccjSourceError(`HTTP ${res.status}`);
  try {
    return JSON.parse(text) as IccjEnvelope;
  } catch {
    throw new IccjSourceError("response is not JSON (anti-bot/redirect?)");
  }
}

// Public: live search proxy. One page (date-DESC). Caller paginates via
// options.page; UI shows page-by-page (caller derives "more" from cumulative loaded vs
// total), never auto-sweeps all 1000.
export async function searchIccj(params: IccjSearchParams, options?: IccjRequestOptions): Promise<IccjSearchResult> {
  return withBreaker(options?.callerClass ?? "ui", () => searchIccjInner(params, options));
}
async function searchIccjInner(params: IccjSearchParams, options?: IccjRequestOptions): Promise<IccjSearchResult> {
  const page = Math.max(1, options?.page ?? 1);
  const signal = combineSignals(options?.signal);

  let cookie = await getSession(signal);
  let json = await postSearch(params, page, cookie, signal);
  let kind = classifyEnvelope(json);

  // Empty or error on the first try might be a stale/invalid session — retry
  // ONCE with a fresh cookie before trusting the result (Codex #3).
  if (kind !== "results") {
    cookie = await getSession(signal, true);
    const json2 = await postSearch(params, page, cookie, signal);
    const kind2 = classifyEnvelope(json2);
    if (kind2 === "results") {
      json = json2;
      kind = kind2;
    } else if (kind2 === "empty") {
      return { dosare: [], total: 0, page };
    } else {
      throw new IccjSourceError("ambiguous empty/error after session refresh");
    }
  }

  const total = parseResultCount(String(json.Keywords)) ?? 0;
  const dosare = parseSearchItems(String(json.Items));
  return { dosare, total, page };
}

// Public: full detail for one dosar (lazy, on row-expand / for monitoring diff / enrich).
// Retries ONCE with a freshly warmed session on a SOURCE error (HTTP / anti-bot /
// oversize), mirroring searchIccj. NOT on IccjParseError — that signals real markup
// drift and must surface, not be masked by a retry. Long enrich runs can outlive
// SESSION_TTL, so a mid-run session expiry self-heals here. Shared by enrich, the
// monitoring iccjRunner, and DosareTable row-expand.
export async function fetchIccjDetail(iccjId: string, options?: IccjRequestOptions): Promise<IccjDosar> {
  return withBreaker(options?.callerClass ?? "ui", () => fetchIccjDetailInner(iccjId, options));
}
async function fetchIccjDetailInner(iccjId: string, options?: IccjRequestOptions): Promise<IccjDosar> {
  if (!/^\d+$/.test(iccjId)) throw new IccjSourceError("invalid iccjId");
  const signal = combineSignals(options?.signal);
  const url = `${DETAIL_URL}?customQuery%5B0%5D.Key=id&customQuery%5B0%5D.Value=${iccjId}`;

  let forceRefresh = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const cookie = await getSession(signal, forceRefresh);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          Referer: SEARCH_PAGE,
          Cookie: cookie,
          "User-Agent": "Mozilla/5.0 (LegalDashboard ICCJ proxy)",
        },
        signal,
      });
      let html: string;
      try {
        html = await readResponseTextWithCap(res, ICCJ_MAX_RESPONSE_BYTES, signal);
      } catch (err) {
        if (err instanceof ResponseTooLargeSignal) throw new IccjSourceError(`detail too large (${err.bytes})`);
        throw err;
      }
      if (!res.ok) throw new IccjSourceError(`detail HTTP ${res.status}`);
      return parseDetail(html, iccjId);
    } catch (err) {
      if (err instanceof IccjSourceError && attempt === 0) {
        console.warn(`[iccj] detaliu ${iccjId}: source error, reincerc cu sesiune proaspata:`, err.message);
        forceRefresh = true;
        continue;
      }
      throw err;
    }
  }
  // Unreachable: the loop either returns or throws on attempt 1.
  throw new IccjSourceError("detail fetch exhausted retries");
}

// ── Sedinte (hearings) parser + search ────────────────────────────────────

// Parse the /737 Items HTML. Each hearing (complet sitting) renders a header
// cell (<td style="width: 30%">: sectie + "Completul ..., ora: HH:MM - date")
// followed by an inner <table> of dosare — BUT empty completuri have a header and
// no table, so the header/table counts differ and positional pairing breaks. We
// instead attach to each dosare <table> the header that IMMEDIATELY PRECEDES it
// in the document, which is robust to interleaved empty completuri. Each inner
// dosar row -> one IccjTermen.
export function parseSedinteItems(itemsHtml: string): IccjTermen[] {
  const out: IccjTermen[] = [];
  // Header positions (end offset + inner html).
  const headers: Array<{ end: number; html: string }> = [];
  for (const m of itemsHtml.matchAll(/<td style="width: 30%">([\s\S]*?)<\/td>/gi)) {
    headers.push({ end: (m.index ?? 0) + m[0].length, html: m[1] });
  }
  for (const tm of itemsHtml.matchAll(/<table>([\s\S]*?)<\/table>/gi)) {
    // Only the dosare tables (they carry a "Numarul dosarului" column).
    if (!/Num[aă]rul dosarului/i.test(tm[1])) continue;
    const pos = tm.index ?? 0;
    // Nearest preceding header.
    let headerHtml = "";
    for (const h of headers) {
      if (h.end <= pos) headerHtml = h.html;
      else break;
    }
    const sectie = stripTags(headerHtml.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? "")
      .replace(/[-–—>→\s]+$/, "")
      .trim();
    const completInfo =
      matchAll(headerHtml, /<p\b[^>]*>([\s\S]*?)<\/p>/gi)
        .map(stripTags)
        .find((p) => /ora/i.test(p)) ?? "";
    const complet = completInfo.replace(/,?\s*ora.*$/i, "").trim();

    const tbody = tm[1].replace(/<thead>[\s\S]*?<\/thead>/i, "");
    for (const row of matchAll(tbody, /<tr>([\s\S]*?)<\/tr>/gi)) {
      const cells = matchAll(row, /<td[^>]*>([\s\S]*?)<\/td>/gi);
      if (cells.length < 3) continue;
      const linkCell = cells[1];
      const iccjId = linkCell.match(/[Vv]alue=(\d+)/)?.[1] ?? "";
      const ps = matchAll(linkCell, /<p\b[^>]*>([\s\S]*?)<\/p>/gi).map(stripTags);
      const numar = stripTags(linkCell.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? ps[0] ?? "");
      if (!numar) continue;
      const dataOra = ps[2] ?? "";
      const data = iccjDateToIso(dataOra.match(/(\d{2}\.\d{2}\.\d{4})/)?.[1] ?? "");
      const ora = dataOra.match(/(\d{1,2}:\d{2})/)?.[1] ?? "";
      const parti = matchAll(cells[2], /<li\b[^>]*>([\s\S]*?)<\/li>/gi)
        .map((li) => stripTags(li).replace(/^-\s*/, ""))
        .filter((s) => s.length > 0 && !/^Vezi mai multe/i.test(s))
        .map((nume) => ({ nume, calitateParte: "" }));
      out.push({
        numarDosar: numar,
        iccjId,
        institutie: ICCJ_INSTITUTIE,
        data,
        ora,
        complet,
        solutie: "",
        solutieSumar: "",
        categorieCaz: sectie,
        stadiuProcesual: ps[1] ?? "",
        parti,
        source: "iccj",
      });
    }
  }
  return out;
}

// Public: live search of ICCJ hearings (termene) by date (+ optional sectie).
// Returns one IccjTermen per (hearing × dosar). A date with no hearings (weekend)
// is a genuine empty -> [].
export async function searchSedinteIccj(
  params: IccjSedinteParams,
  options?: IccjRequestOptions
): Promise<IccjTermen[]> {
  return withBreaker(options?.callerClass ?? "ui", () => searchSedinteIccjInner(params, options));
}
async function searchSedinteIccjInner(params: IccjSedinteParams, options?: IccjRequestOptions): Promise<IccjTermen[]> {
  const signal = combineSignals(options?.signal);
  const cookie = await getSession(signal);

  const body = new URLSearchParams();
  body.set("formTypeId", "6");
  body.set("CustomQuery[0].Key", "Department");
  body.set("CustomQuery[0].Value", params.sectie ?? "");
  body.set("CustomQuery[1].Key", "StartDate");
  body.set("CustomQuery[1].Value", isoToIccjDate(params.data));
  body.set("CustomQuery[2].Key", "EndDate");
  body.set("CustomQuery[2].Value", isoToIccjDate(params.dataStop || params.data));

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    "X-Requested-With": "XMLHttpRequest",
    Referer: SEDINTE_PAGE,
    "User-Agent": "Mozilla/5.0 (LegalDashboard ICCJ proxy)",
  };
  if (cookie) headers.Cookie = cookie;

  const res = await fetch(SEDINTE_ACTION, { method: "POST", headers, body: body.toString(), signal });
  let text: string;
  try {
    text = await readResponseTextWithCap(res, ICCJ_MAX_RESPONSE_BYTES, signal);
  } catch (err) {
    if (err instanceof ResponseTooLargeSignal) throw new IccjSourceError(`sedinte too large (${err.bytes})`);
    throw err;
  }
  if (!res.ok) throw new IccjSourceError(`sedinte HTTP ${res.status}`);
  let json: IccjEnvelope;
  try {
    json = JSON.parse(text) as IccjEnvelope;
  } catch {
    throw new IccjSourceError("sedinte response is not JSON");
  }
  if (json.Status !== 1) throw new IccjSourceError("sedinte Status != 1");
  if (json.Items === null || json.Items === undefined) return []; // no hearings that day
  if (typeof json.Items !== "string") throw new IccjSourceError("sedinte Items not a string");
  return parseSedinteItems(json.Items);
}

// ── Termene by dosar/parte (dosar search -> detail -> flatten sedinte) ─────

// Cap on per-search detail fetches: a docket search is 1 fetch; a name search
// can match many dosare, and we fetch each one's detail to collect its sedinte.
const MAX_TERMENE_DOSARE = 20;
const TERMENE_DETAIL_CONCURRENCY = 5;

export interface IccjTermeneResult {
  termene: IccjTermen[];
  dosareCount: number; // distinct dosare whose termene were collected
  truncated: boolean; // true when more dosare matched than we fetched details for
}

// User model for the Termene page: "search a dosar/name and see ALL the dates it
// appeared / will appear" — NOT "what is on the docket on day X". So we search
// dosare (by numar/parte/obiect/sectie via /738), fetch each match's detail, and
// flatten every dosar's `sedinte` into Termen rows. No date is required; an
// optional date range filters the resulting termene client-side.
export async function searchTermeneByDosarIccj(
  params: IccjSearchParams,
  options?: IccjRequestOptions
): Promise<IccjTermeneResult> {
  const found = await searchIccj(params, { signal: options?.signal, page: 1, callerClass: options?.callerClass });
  const dosare = found.dosare.slice(0, MAX_TERMENE_DOSARE);
  // truncated = more dosare matched than we collected termene for. found.dosare is the
  // full page-1 set; `found.total > found.dosare.length` means further pages exist.
  const truncated = found.dosare.length > MAX_TERMENE_DOSARE || found.total > found.dosare.length;

  const termene: IccjTermen[] = [];
  // Fetch details in small batches to stay polite to scj.ro while bounding latency.
  // Per-item isolation: one dosar's parse/source failure must NOT abort the whole batch
  // (bare Promise.all would reject all). Log it and continue so the user still gets the
  // termene we could read. AbortError still propagates so cancellation works.
  for (let i = 0; i < dosare.length; i += TERMENE_DETAIL_CONCURRENCY) {
    const batch = dosare.slice(i, i + TERMENE_DETAIL_CONCURRENCY);
    const details = await Promise.all(
      batch.map((d) =>
        fetchIccjDetail(d.iccjId, { signal: options?.signal, callerClass: options?.callerClass }).catch((err) => {
          // Only a TRUE caller abort tears down the batch; a per-item timeout is isolated.
          if (options?.signal?.aborted) throw err;
          console.warn(`[iccj] termene: detaliu esuat pentru dosar ${d.iccjId}:`, err);
          return null;
        })
      )
    );
    for (const detail of details) {
      if (!detail) continue;
      for (const s of detail.sedinte) {
        termene.push({
          numarDosar: detail.numar,
          iccjId: detail.iccjId,
          institutie: detail.institutie,
          data: s.data,
          ora: s.ora,
          complet: s.complet,
          solutie: s.solutie,
          solutieSumar: s.solutieSumar,
          categorieCaz: detail.departament,
          stadiuProcesual: detail.stadiuProcesual,
          parti: detail.parti,
          source: "iccj",
        });
      }
    }
  }
  return { termene, dosareCount: dosare.length, truncated };
}

// Merge a /1094 detail into a /738 list dosar. Detail is authoritative for the fields the
// list lacks (categorie/materie, party roles, sedinte) but we keep the list's stable
// identity/columns and fall back to list values on empty detail fields (markup-drift safety).
function mergeIccjDetailBackend(listDosar: IccjDosar, detail: IccjDosar): IccjDosar {
  return {
    ...listDosar,
    categorieCaz: detail.categorieCaz || listDosar.categorieCaz,
    stadiuProcesual: detail.stadiuProcesual || listDosar.stadiuProcesual,
    parti: detail.parti.length > 0 ? detail.parti : listDosar.parti,
    sedinte: detail.sedinte,
    departament: detail.departament || listDosar.departament,
    numarVechi: detail.numarVechi ?? listDosar.numarVechi,
    dataInitiala: detail.dataInitiala ?? listDosar.dataInitiala,
    stadiulProcesualCombinat: detail.stadiulProcesualCombinat ?? listDosar.stadiulProcesualCombinat,
    obiecteSecundare: detail.obiecteSecundare ?? listDosar.obiecteSecundare,
    caiAtac: detail.caiAtac ?? listDosar.caiAtac,
  };
}

// Public: search ICCJ dosare AND enrich them server-side — fetch each match's /1094 detail
// (categorie + party roles + sedinte, which the /738 list omits) and merge it in, so the
// caller gets fully-populated dosare in one response with NO client-side enrichment step.
// Enrichment is bounded (concurrency) + per-item isolated (one parse/source failure does not
// drop the batch); a failed dosar is returned as its bare list row. Used by the /api/dosare-iccj
// route only — NOT by monitoring or termene, which read plain searchIccj.
export async function searchIccjEnriched(
  params: IccjSearchParams,
  options?: IccjRequestOptions
): Promise<IccjSearchResult> {
  const found = await searchIccj(params, options);
  if (found.dosare.length === 0) return found;

  // Aggregate wall-clock budget: bound total latency below typical proxy timeouts.
  // When it fires, in-flight detail fetches abort (treated as per-item timeout →
  // isolated, see catch below) and we stop launching new batches — remaining rows
  // return un-enriched rather than failing the whole search.
  const deadline = AbortSignal.timeout(ICCJ_ENRICH_BUDGET_MS);
  const enrichSignal = options?.signal ? AbortSignal.any([options.signal, deadline]) : deadline;

  const enriched: IccjDosar[] = [...found.dosare];
  for (let i = 0; i < enriched.length; i += TERMENE_DETAIL_CONCURRENCY) {
    if (deadline.aborted || options?.signal?.aborted) break;
    const slice = enriched.slice(i, i + TERMENE_DETAIL_CONCURRENCY);
    const details = await Promise.all(
      slice.map((d) =>
        fetchIccjDetail(d.iccjId, { signal: enrichSignal, callerClass: options?.callerClass }).catch((err) => {
          // Only a TRUE caller abort tears down the batch. A per-item TIMEOUT (the
          // budget/per-fetch AbortSignal.timeout firing) surfaces as an AbortError too
          // — isolate it as a skipped row instead of failing the whole search (Codex F3).
          if (options?.signal?.aborted) throw err;
          console.warn(`[iccj] enrich: detaliu esuat pentru dosar ${d.iccjId}:`, err);
          return null;
        })
      )
    );
    details.forEach((detail, j) => {
      if (detail) enriched[i + j] = mergeIccjDetailBackend(enriched[i + j], detail);
    });
  }
  return { dosare: enriched, total: found.total, page: found.page };
}

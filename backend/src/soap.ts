import { readResponseTextWithCap, ResponseTooLargeSignal } from "./util/streamCap.ts";

// NOTE: portalquery.just.ro does NOT support HTTPS (government legacy service)
// Traffic is unencrypted - this is an accepted risk as no auth data is transmitted
const SOAP_ENDPOINT = "http://portalquery.just.ro/query.asmx";
const NS = "portalquery.just.ro";

export interface SearchParams {
  numarDosar?: string;
  obiectDosar?: string;
  numeParte?: string;
  institutie?: string;
  dataStart?: string;
  dataStop?: string;
}

// PortalJust SOAP uses old-style Romanian cedilla diacritics (U+015E/015F, U+0162/0163)
// Modern Romanian uses comma-below variants (U+0218/0219, U+021A/021B).
// Convert modern → legacy so the SOAP search matches.
export function toLegacyDiacritics(s: string): string {
  return s
    .replace(/\u0218/g, "\u015E") // Ș → Ş
    .replace(/\u0219/g, "\u015F") // ș → ş
    .replace(/\u021A/g, "\u0162") // Ț → Ţ
    .replace(/\u021B/g, "\u0163"); // ț → ţ
}

// PortalJust's full-text index concatenates dot-separated abbreviations: the
// stored party "EURO ASFALT D.O.O. SARAJEVO" is indexed under the single token
// "DOO", and a search for "DOO" matches it. The search-side word breaker,
// however, splits a dotted abbreviation in the QUERY ("D.O.O.") into the
// single-letter tokens D/O/O, which never match the concatenated "DOO" token —
// so the whole query returns zero results. Verified against the live service
// (2026-06): "EURO ASFALT D.O.O. SARAJEVO" -> 0 hits, "EURO ASFALT DOO SARAJEVO"
// -> the 2 real cases. Stripping dots realigns the query with the index
// (D.O.O.->DOO, S.R.L.->SRL, S.A.->SA, P.F.A.->PFA — the common punctuated
// Romanian/foreign legal forms). Lossless: the index holds no dotted tokens, so
// a dotted query can never match more than its stripped form (confirmed:
// "BANCA TRANSILVANIA S.A." returns the same set as "...SA"). Replacing dots
// with spaces does NOT work ("EURO ASFALT D O O SARAJEVO" -> 0); the letters
// must merge into one token.
export function stripSearchDots(s: string): string {
  return s.replace(/\./g, "");
}

// XML helpers
function esc(s: string): string {
  return (
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;")
      // Strip control characters that could confuse XML parsers (XML 1.0 disallows
      // U+0000..U+0008, U+000B, U+000C, U+000E..U+001F outside character references).
      // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional XML 1.0 invalid-character stripping
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
  );
}

// For nillable typed elements (enum, dateTime) - send xsi:nil when empty
function nilOrValue(name: string, value?: string): string {
  if (!value || value.trim() === "") {
    return `<${name} xsi:nil="true"/>`;
  }
  return `<${name}>${esc(value)}</${name}>`;
}

function buildEnvelope(action: string, body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${action} xmlns="${NS}">
      ${body}
    </${action}>
  </soap:Body>
</soap:Envelope>`;
}

// Internal hard cap: PortalJust SOAP can hang on bad payloads. Always pair a
// caller-supplied signal with this timeout via `AbortSignal.any` so neither
// side starves — caller abort cancels the in-flight fetch immediately, and
// the timeout still fires if the caller is unbounded.
//
// v2.14.1: bumped from 45s → 60s. Empirical evidence on prod DB job 1215
// (BANCA COMERCIALA ROMANA SA, ~50% failure rate at 45s with all failures
// timing out at exactly 45s while successful runs landed at 40-44s — fix at
// the threshold). 60s gives the upstream a 33% margin without inflating the
// scheduler-level budget (still 10min/run via DEFAULT_BUDGET_MS).
const SOAP_TIMEOUT_MS = 60000;
// v2.27.1: bumped from 8MB → 50MB after the search "AUTO IN SRL" tripped the
// 8MB guard. PortalJust caps internally at 1000 dosare/response; an empirical
// worst case (1000 dosare with rich parti+sedinte) lands at ~17MB. 50MB gives
// ~3× margin so future per-dosar growth doesn't reject legitimate broad
// searches, while still bounding OOM/DoS exposure from a runaway upstream.
export const SOAP_MAX_RESPONSE_BYTES = 50 * 1024 * 1024;

// Typed error so route handlers can map the size-cap trip to HTTP 413
// ("restrange filtrele") instead of the generic 500 ("retry") which is
// misleading when the response is deterministic-too-large.
export class SoapResponseTooLargeError extends Error {
  readonly code = "SOAP_RESPONSE_TOO_LARGE";
  readonly bytes: number;
  constructor(bytes: number) {
    super("Raspunsul PortalJust depaseste limita interna.");
    this.name = "SoapResponseTooLargeError";
    this.bytes = bytes;
  }
}

function combineSignals(external?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(SOAP_TIMEOUT_MS);
  return external ? AbortSignal.any([external, timeout]) : timeout;
}

async function callSoap(action: string, body: string, signal?: AbortSignal): Promise<string> {
  const envelope = buildEnvelope(action, body);
  const combinedSignal = combineSignals(signal);

  const response = await fetch(SOAP_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: `"${NS}/${action}"`,
    },
    body: envelope,
    signal: combinedSignal,
  });

  let text: string;
  try {
    text = await readResponseTextWithCap(response, SOAP_MAX_RESPONSE_BYTES, combinedSignal);
  } catch (err) {
    if (err instanceof ResponseTooLargeSignal) {
      console.error(`SOAP response prea mare: ${err.bytes} bytes (cap ${SOAP_MAX_RESPONSE_BYTES})`);
      throw new SoapResponseTooLargeError(err.bytes);
    }
    throw err;
  }

  if (!response.ok || text.includes("soap:Fault")) {
    const fault = text.match(/<faultstring>([\s\S]*?)<\/faultstring>/)?.[1] ?? "necunoscut";
    // SECURITY: Log full fault server-side, throw generic message to client
    console.error("SOAP Fault detalii:", fault);
    throw new Error("Eroare la comunicarea cu serviciul PortalJust.");
  }
  return text;
}

// Decode XML entities in text content (leaf fields only — not applied inside
// extractFirst/extractAll, which may return inner XML that downstream callers
// re-parse for nested tags).
// Order matters: numeric refs first, then named refs, &amp; LAST so we don't
// double-decode sequences like "&amp;lt;" → "<".
export function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// XML parsing helpers
// Match exact tag names: require \s or > after tag name, exclude self-closing tags
// Exported for unit tests; not part of the route-level public API.
export function extractFirst(xml: string, tag: string): string {
  const re = new RegExp(
    `<(?:[^:>]+:)?${tag}(?=[\\s>])(?!(?:[^>]*\\/>))[^>]*>([\\s\\S]*?)<\\/(?:[^:>]+:)?${tag}\\s*>`,
    "i"
  );
  return xml.match(re)?.[1]?.trim() ?? "";
}

export function extractAll(xml: string, tag: string): string[] {
  const re = new RegExp(
    `<(?:[^:>]+:)?${tag}(?=[\\s>])(?!(?:[^>]*\\/>))[^>]*>([\\s\\S]*?)<\\/(?:[^:>]+:)?${tag}\\s*>`,
    "gi"
  );
  return Array.from(xml.matchAll(re), (match) => match[1].trim());
}

export type Dosar = ReturnType<typeof parseDosar>;
export function parseDosar(xml: string) {
  // Extract nested sections first
  const partiXml = extractFirst(xml, "parti");
  const parti = extractAll(partiXml, "DosarParte").map((p) => ({
    nume: decodeXmlEntities(extractFirst(p, "nume")),
    calitateParte: decodeXmlEntities(extractFirst(p, "calitateParte")),
  }));

  const sedinteXml = extractFirst(xml, "sedinte");
  const sedinte = extractAll(sedinteXml, "DosarSedinta").map((s) => ({
    complet: decodeXmlEntities(extractFirst(s, "complet")),
    data: extractFirst(s, "data"),
    ora: extractFirst(s, "ora"),
    solutie: decodeXmlEntities(extractFirst(s, "solutie")),
    solutieSumar: decodeXmlEntities(extractFirst(s, "solutieSumar")),
    documentSedinta: decodeXmlEntities(extractFirst(s, "documentSedinta")),
    numarDocument: extractFirst(s, "numarDocument"),
    dataPronuntare: extractFirst(s, "dataPronuntare"),
  }));

  // Strip nested sections so flat field extraction doesn't pick up inner tags
  const flat = xml
    .replace(/<parti>[\s\S]*?<\/parti>/gi, "")
    .replace(/<sedinte>[\s\S]*?<\/sedinte>/gi, "")
    .replace(/<caiAtac>[\s\S]*?<\/caiAtac>/gi, "");

  return {
    numar: extractFirst(flat, "numar"),
    data: extractFirst(flat, "data"),
    institutie: decodeXmlEntities(extractFirst(flat, "institutie")),
    departament: decodeXmlEntities(extractFirst(flat, "departament")),
    categorieCaz: decodeXmlEntities(extractFirst(flat, "categorieCazNume") || extractFirst(flat, "categorieCaz")),
    stadiuProcesual: decodeXmlEntities(
      extractFirst(flat, "stadiuProcesualNume") || extractFirst(flat, "stadiuProcesual")
    ),
    obiect: decodeXmlEntities(extractFirst(flat, "obiect")),
    parti,
    sedinte,
  };
}

export interface CautareDosareOptions {
  // External AbortSignal — typically the SSE controller's signal in
  // /load-more, or `c.req.raw.signal` for plain GET handlers. Combined with
  // the internal 60s SOAP timeout so caller cancellation propagates the
  // moment a client disconnects, not 60s later.
  signal?: AbortSignal;
}

export async function cautareDosare(params: SearchParams, options?: CautareDosareOptions) {
  const body = `
    <numarDosar>${esc(toLegacyDiacritics(params.numarDosar ?? ""))}</numarDosar>
    <obiectDosar>${esc(toLegacyDiacritics(params.obiectDosar ?? ""))}</obiectDosar>
    <numeParte>${esc(toLegacyDiacritics(stripSearchDots(params.numeParte ?? "")))}</numeParte>
    ${nilOrValue("institutie", params.institutie)}
    ${nilOrValue("dataStart", params.dataStart)}
    ${nilOrValue("dataStop", params.dataStop)}
  `;

  const xml = await callSoap("CautareDosare", body, options?.signal);
  // v2.37.1 (review cluster 3): un body 200 fara envelope-ul asteptat (pagina
  // WAF/proxy/mentenanta, tag redenumit) NU e totuna cu "0 rezultate". Fara
  // guard, [] ajunge in dosarSoapRunner -> diff -> dosar_disappeared FALS +
  // snapshot resetat la lastDosarPresent=false.
  // FIX v2.38.0: pentru 0 rezultate PortalJust intoarce <CautareDosareResponse/>
  // GOL, FARA niciun <CautareDosareResult> (verificat live: 299 bytes,
  // `<CautareDosareResponse xmlns="portalquery.just.ro" />`). Guard-ul vechi pe
  // <CautareDosareResult> arunca fals "envelope absent" pe cautarile cu 0
  // rezultate (eroare la cautare + fals "sursa indisponibila" in monitoring).
  // Verificam acum wrapper-ul <CautareDosareResponse> — prezent si la 0
  // rezultate, si cu rezultate; absent doar pe o pagina non-SOAP. extractFirst
  // de mai jos intoarce [] cand <CautareDosareResult> lipseste = 0 rezultate.
  if (!/<CautareDosareResponse[\s>\/]/.test(xml)) {
    console.error(`[soap] CautareDosare: raspuns 200 fara envelope (lungime ${xml.length})`);
    throw new Error("Raspuns neasteptat de la PortalJust (envelope absent).");
  }
  const resultXml = extractFirst(xml, "CautareDosareResult");
  if (!resultXml) return [];

  return extractAll(resultXml, "Dosar").map(parseDosar);
}

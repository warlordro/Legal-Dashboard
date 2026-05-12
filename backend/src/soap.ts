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
const SOAP_MAX_RESPONSE_BYTES = 8 * 1024 * 1024; // 8MB

function combineSignals(external?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(SOAP_TIMEOUT_MS);
  return external ? AbortSignal.any([external, timeout]) : timeout;
}

async function callSoap(action: string, body: string, signal?: AbortSignal): Promise<string> {
  const envelope = buildEnvelope(action, body);

  const response = await fetch(SOAP_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: `"${NS}/${action}"`,
    },
    body: envelope,
    signal: combineSignals(signal),
  });

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > SOAP_MAX_RESPONSE_BYTES) {
    // SECURITY: previne OOM/DoS pasiv din upstream PortalJust.
    console.error(`SOAP response prea mare: ${contentLength} bytes (cap ${SOAP_MAX_RESPONSE_BYTES})`);
    throw new Error("Eroare la comunicarea cu serviciul PortalJust.");
  }

  const text = await response.text();
  if (text.length > SOAP_MAX_RESPONSE_BYTES) {
    // Content-Length poate lipsi sau minti pe chunked encoding.
    console.error(`SOAP response prea mare (post-read): ${text.length} bytes`);
    throw new Error("Eroare la comunicarea cu serviciul PortalJust.");
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
    <numeParte>${esc(toLegacyDiacritics(params.numeParte ?? ""))}</numeParte>
    ${nilOrValue("institutie", params.institutie)}
    ${nilOrValue("dataStart", params.dataStart)}
    ${nilOrValue("dataStop", params.dataStop)}
  `;

  const xml = await callSoap("CautareDosare", body, options?.signal);
  const resultXml = extractFirst(xml, "CautareDosareResult");
  if (!resultXml) return [];

  return extractAll(resultXml, "Dosar").map(parseDosar);
}

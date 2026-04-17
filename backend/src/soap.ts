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
    .replace(/\u0218/g, "\u015E")  // Ș → Ş
    .replace(/\u0219/g, "\u015F")  // ș → ş
    .replace(/\u021A/g, "\u0162")  // Ț → Ţ
    .replace(/\u021B/g, "\u0163"); // ț → ţ
}

// XML helpers
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // Strip control characters that could confuse XML parsers
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
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

async function callSoap(action: string, body: string): Promise<string> {
  const envelope = buildEnvelope(action, body);

  const response = await fetch(SOAP_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: `"${NS}/${action}"`,
    },
    body: envelope,
    signal: AbortSignal.timeout(45000),
  });

  const text = await response.text();
  if (!response.ok || text.includes("soap:Fault")) {
    const fault = text.match(/<faultstring>([\s\S]*?)<\/faultstring>/)?.[1] ?? "necunoscut";
    // SECURITY: Log full fault server-side, throw generic message to client
    console.error("SOAP Fault detalii:", fault);
    throw new Error("Eroare la comunicarea cu serviciul PortalJust.");
  }
  return text;
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
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    results.push(m[1].trim());
  }
  return results;
}

export function parseDosar(xml: string) {
  // Extract nested sections first
  const partiXml = extractFirst(xml, "parti");
  const parti = extractAll(partiXml, "DosarParte").map((p) => ({
    nume: extractFirst(p, "nume"),
    calitateParte: extractFirst(p, "calitateParte"),
  }));

  const sedinteXml = extractFirst(xml, "sedinte");
  const sedinte = extractAll(sedinteXml, "DosarSedinta").map((s) => ({
    complet: extractFirst(s, "complet"),
    data: extractFirst(s, "data"),
    ora: extractFirst(s, "ora"),
    solutie: extractFirst(s, "solutie"),
    solutieSumar: extractFirst(s, "solutieSumar"),
    documentSedinta: extractFirst(s, "documentSedinta"),
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
    institutie: extractFirst(flat, "institutie"),
    departament: extractFirst(flat, "departament"),
    categorieCaz: extractFirst(flat, "categorieCazNume") || extractFirst(flat, "categorieCaz"),
    stadiuProcesual: extractFirst(flat, "stadiuProcesualNume") || extractFirst(flat, "stadiuProcesual"),
    obiect: extractFirst(flat, "obiect"),
    parti,
    sedinte,
  };
}

export async function cautareDosare(params: SearchParams) {
  const body = `
    <numarDosar>${esc(toLegacyDiacritics(params.numarDosar ?? ""))}</numarDosar>
    <obiectDosar>${esc(toLegacyDiacritics(params.obiectDosar ?? ""))}</obiectDosar>
    <numeParte>${esc(toLegacyDiacritics(params.numeParte ?? ""))}</numeParte>
    ${nilOrValue("institutie", params.institutie)}
    ${nilOrValue("dataStart", params.dataStart)}
    ${nilOrValue("dataStop", params.dataStop)}
  `;

  const xml = await callSoap("CautareDosare", body);
  const resultXml = extractFirst(xml, "CautareDosareResult");
  if (!resultXml) return [];

  return extractAll(resultXml, "Dosar").map(parseDosar);
}

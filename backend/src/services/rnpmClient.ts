import { z } from "zod";
import { readResponseTextWithCap, ResponseTooLargeSignal } from "../util/streamCap.ts";

export const RNPM_BASE_URL = "https://mj.rnpm.ro";

export type RnpmSearchType = "ipoteci" | "fiducii" | "specifice" | "creante" | "obligatiuni";

export interface SiSau {
  type: "1" | "2";
  value: string;
}

export interface RnpmSearchParams {
  gcode: string;
  identificatorInscriere?: string;
  tipInscriere?: SiSau;
  destinatieInscriere?: SiSau;
  activ?: boolean;
  nemodificat?: boolean;
  perioadaStart?: string;
  perioadaFinal?: string;
  tipAct?: string;
  nrAct?: SiSau;
  dataAct?: SiSau;
  creditorPJ?: { denumire?: string; regCom?: SiSau; CUI?: SiSau };
  CreditorPF?: { nume?: string; prenume?: SiSau; CNP?: SiSau };
  debitorPJ?: { denumire?: string; RegCom?: SiSau; CUI?: SiSau };
  debitorPF?: { nume?: string; prenume?: SiSau; CNP?: SiSau };
  bunV?: { model?: string; serieSasiu?: SiSau; serieMotor?: SiSau; nrImatriculare?: SiSau; descriere?: SiSau };
  bunA?: { categorie?: string; identificare?: SiSau; descriere?: string };
  parteJ?: { denumire?: string; RegCom?: SiSau; CUI?: SiSau };
  parteF?: { nume?: string; prenume?: SiSau; CNP?: SiSau };
  bunM?: { categorie?: string; identificare?: SiSau };
  tertPJ?: { denumire?: string; RegCom?: SiSau; CUI?: SiSau };
  tertPF?: { nume?: string; prenume?: SiSau; CNP?: SiSau };
  constituitorPJ?: { denumire?: string; RegCom?: SiSau; CUI?: SiSau };
  constituitorPF?: { nume?: string; prenume?: SiSau; CNP?: SiSau };
  fiduciar?: { denumire?: string; RegCom?: SiSau; CUI?: SiSau };
  beneficiarPJ?: { denumire?: string; RegCom?: SiSau; CUI?: SiSau };
  beneficiarPF?: { nume?: string; prenume?: SiSau; CNP?: SiSau };
  reprezentantCreditor?: { denumire?: string; regCom?: SiSau; CUI?: SiSau };
  debitorJ?: { denumire?: string; RegCom?: SiSau; CUI?: SiSau };
  debitorF?: { nume?: string; prenume?: SiSau; CNP?: SiSau };
  creante?: { descriere?: string };
  // Obligatiuni ipotecare — chei confirmate prin captura Network.
  agentPJ?: { denumire?: string; RegCom?: SiSau; CUI?: SiSau };
  agentPF?: { nume?: string; prenume?: SiSau; CNP?: SiSau };
  emitent?: { denumire?: string; RegCom?: SiSau; CUI?: SiSau };
  bunGarantie?: { descriere?: string };
}

export interface RnpmIdentificator {
  v: string;
  k: string | null;
}

export interface RnpmDocument {
  no: number;
  identificator: RnpmIdentificator;
  utilizatorAutorizat: string;
  data: string;
  tip: string;
  needsActualizare: boolean;
  activ?: boolean | null;
}

export interface RnpmSearchResult {
  total: number;
  pagesTotal: number;
  pageSize: number;
  currentPage: number;
  documents: RnpmDocument[];
  criteriu: string;
  eai: boolean;
}

export interface RnpmDetailPart1 {
  destinatie?: string;
  tipAct?: string;
  numar?: string;
  dataInreg?: string;
  dataExpirare?: string;
  inscriereInitiala?: RnpmIdentificator;
  inscriereModificatoare?: RnpmIdentificator;
  inscriereModificata?: RnpmIdentificator;
  activ?: boolean | null;
  alteMentiuni?: string;
  [key: string]: unknown;
}

export interface RnpmDetailPartyPJ {
  denumire?: string;
  tip?: string;
  sediu?: string;
  nrIdentificare?: string;
  cod?: string;
  tara?: string;
  localitate?: string;
  judet?: string;
  codPostal?: string;
  alteDate?: string;
  subscriptor?: boolean;
  no?: number;
  calitate?: string;
  altaCalitate?: string;
  [key: string]: unknown;
}

export interface RnpmDetailPartyPF {
  nume?: string;
  prenume?: string;
  cnp?: string;
  sediu?: string;
  tara?: string;
  localitate?: string;
  judet?: string;
  codPostal?: string;
  alteDate?: string;
  subscriptor?: boolean;
  no?: number;
  calitate?: string;
  altaCalitate?: string;
  [key: string]: unknown;
}

export interface RnpmDetailPartyPFDebitor extends RnpmDetailPartyPF {
  calitate?: string;
}
export interface RnpmDetailPartyPJDebitor extends RnpmDetailPartyPJ {
  calitate?: string;
}

export interface RnpmDetailPart2 {
  creditoriF?: RnpmDetailPartyPF[];
  creditoriJ?: RnpmDetailPartyPJ[];
  // Specifice: parti (single bucket, calitate + altaCalitate) in loc de creditori/debitori.
  partiF?: RnpmDetailPartyPF[];
  partiJ?: RnpmDetailPartyPJ[];
  [key: string]: unknown;
}

export interface RnpmDetailPart3 {
  debitoriF?: RnpmDetailPartyPFDebitor[];
  debitoriJ?: RnpmDetailPartyPJDebitor[];
  // Specifice: bunuri simple (doar descriere) direct in part3.
  bunuri?: RnpmDetailBun[];
  [key: string]: unknown;
}

export interface RnpmDetailBun {
  categorie?: string;
  identificare?: string;
  descriere?: string;
  model?: string;
  serieSasiu?: string;
  serieMotor?: string;
  nrInmatriculare?: string;
  constituitoriF?: number[];
  constituitoriJ?: number[];
  tertiF?: RnpmDetailPartyPF[];
  tertiJ?: RnpmDetailPartyPJ[];
  [key: string]: unknown;
}

export interface RnpmDetailBunGroup {
  count?: number;
  bunuri?: RnpmDetailBun[];
}
export type RnpmDetailBunBucket = RnpmDetailBun[] | Record<string, RnpmDetailBunGroup>;

export interface RnpmDetailPart4 {
  detaliiComune?: string;
  vehicule?: RnpmDetailBunBucket;
  mobile?: RnpmDetailBunBucket;
  alte?: RnpmDetailBunBucket;
  [key: string]: unknown;
}

export interface RnpmIstoricEntry {
  identificator: RnpmIdentificator;
  data: string;
  tip: string;
  inscriereM?: RnpmIdentificator;
  [key: string]: unknown;
}

export interface RnpmFullDetail {
  part1: RnpmDetailPart1 | null;
  part2: RnpmDetailPart2 | null;
  part3: RnpmDetailPart3 | null;
  part4: RnpmDetailPart4 | null;
  istoric: RnpmIstoricEntry[];
}

export class RnpmError extends Error {
  readonly status?: number;
  readonly cause?: unknown;
  // Machine-readable code + details. Folosit de routes/rnpm.ts ca sa
  // returneze {code, total, ...} cand limita upstream e atinsa, ca frontend-ul
  // sa stie sa propuna split-ul fara sa parse-uiasca string-ul de eroare.
  readonly code?: string;
  readonly details?: Record<string, unknown>;
  constructor(message: string, status?: number, cause?: unknown, code?: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "RnpmError";
    this.status = status;
    this.cause = cause;
    this.code = code;
    this.details = details;
  }
}

const RnpmSearchResultSchema = z
  .object({
    documents: z.array(z.unknown()),
    total: z.number().int().nonnegative(),
    pagesTotal: z.number().int().nonnegative(),
    pageSize: z.number().int().positive(),
    criteriu: z.string().nullish(),
  })
  .passthrough();

// v2.22.0 — User-Agent citit lazy din env la fiecare apel. RNPM poate adauga
// rate-limit pe UA-uri vechi (Chrome 125 e din 2024); operatorul rebumpeaza
// `RNPM_USER_AGENT` fara rebuild. Functie, nu const, ca process.env sa fie
// citit dupa ce dotenv.config() din index.ts a populat env-ul.
const DEFAULT_RNPM_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

function defaultHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "ro-RO,ro;q=0.9,en;q=0.8",
    Origin: RNPM_BASE_URL,
    Referer: `${RNPM_BASE_URL}/`,
    "User-Agent": process.env.RNPM_USER_AGENT?.trim() || DEFAULT_RNPM_USER_AGENT,
  };
}

export interface RnpmClientOptions {
  requestDelayMs?: number;
  fetchImpl?: typeof fetch;
}

// v2.37.1 (review cluster 4): RNPM era singurul upstream FARA backstop de
// timeout (soap.ts are 60s, iccjClient 30s) — un socket mj.rnpm.ro agatat
// tinea cererea (si gcode-ul captcha deja platit) la nesfarsit, iar dupa
// expirarea TTL-ului de idempotency retry-ul clientului pornea o cautare
// duplicata CONCURENTA. Timeout per-fetch, env-tunable.
// Lazy read (nu constanta module-top) ca testele sa poata seta env-ul dupa import.
function rnpmTimeoutMs(): number {
  const raw = Number.parseInt(process.env.RNPM_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 60_000;
}

function withRnpmTimeout(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(rnpmTimeoutMs());
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

// SEC-07: RNPM era singurul upstream care buffera raspunsul integral prin
// `res.json()` fara plafon — un mj.rnpm.ro compromis/agatat putea trimite un
// body arbitrar de mare (OOM/DoS). Cap-ul (default 20MB, env override) opreste
// citirea la prag; peste el aruncam RnpmError "response_too_large".
const RNPM_MAX_RESPONSE_BYTES = (() => {
  const raw = Number.parseInt(process.env.RNPM_MAX_RESPONSE_BYTES ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 20 * 1024 * 1024;
})();

async function readRnpmJson(res: Response, signal: AbortSignal): Promise<unknown> {
  let text: string;
  try {
    text = await readResponseTextWithCap(res, RNPM_MAX_RESPONSE_BYTES, signal);
  } catch (err) {
    if (err instanceof ResponseTooLargeSignal) {
      throw new RnpmError(`Raspuns RNPM prea mare (${err.bytes} bytes).`, 502, undefined, "response_too_large");
    }
    throw err;
  }
  return JSON.parse(text); // JSON invalid ramane SyntaxError, ca azi
}

export class RnpmClient {
  private readonly delayMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: RnpmClientOptions = {}) {
    this.delayMs = opts.requestDelayMs ?? 2000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async search(
    type: RnpmSearchType,
    params: RnpmSearchParams,
    page = 1,
    signal?: AbortSignal
  ): Promise<RnpmSearchResult> {
    const url = `${RNPM_BASE_URL}/api/search/${type}/${page}`;
    const composed = withRnpmTimeout(signal);
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: defaultHeaders(),
      body: JSON.stringify(params),
      signal: composed,
    });
    if (!res.ok) {
      const body = await readResponseTextWithCap(res, RNPM_MAX_RESPONSE_BYTES, composed).catch(() => "");
      throw new RnpmError(`Eroare RNPM search (${res.status}): ${body.slice(0, 200)}`, res.status);
    }
    const raw = await readRnpmJson(res, composed);
    const parsed = RnpmSearchResultSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn(
        "[rnpm] runtime validation failed pe payload search:",
        JSON.stringify(parsed.error.flatten().fieldErrors).slice(0, 500)
      );
      if (process.env.RNPM_RUNTIME_VALIDATION_DISABLED === "1") return raw as RnpmSearchResult;
      throw new RnpmError("Raspunsul RNPM nu respecta schema asteptata.", 502, undefined, "schema_violation");
    }
    return parsed.data as unknown as RnpmSearchResult;
  }

  async fetchPart(uuid: string, part: 1 | 2 | 3 | 4, signal?: AbortSignal): Promise<unknown> {
    const url = `${RNPM_BASE_URL}/api/view/inscriere/${uuid}?part=${part}`;
    const composed = withRnpmTimeout(signal);
    const res = await this.fetchImpl(url, { headers: defaultHeaders(), signal: composed });
    if (res.status === 400 || res.status === 404 || res.status === 410) return null;
    if (!res.ok) {
      const body = await readResponseTextWithCap(res, RNPM_MAX_RESPONSE_BYTES, composed).catch(() => "");
      throw new RnpmError(`Eroare RNPM detail part ${part} (${res.status}): ${body.slice(0, 200)}`, res.status);
    }
    return await readRnpmJson(res, composed);
  }

  async fetchIstoric(uuid: string, signal?: AbortSignal): Promise<RnpmIstoricEntry[]> {
    const url = `${RNPM_BASE_URL}/api/view/istoric/${uuid}`;
    // The istoric endpoint is flaky — same URL occasionally returns 400 "command
    // execution error" then 200 with data a few seconds later. Retry once with a
    // short backoff before giving up. Un singur buget de timeout acopera ambele
    // attempts (v2.37.1).
    const composed = withRnpmTimeout(signal);
    const doFetch = () => this.fetchImpl(url, { headers: defaultHeaders(), signal: composed });
    let res = await doFetch();
    if (res.status === 400) {
      await new Promise((r) => setTimeout(r, 1500));
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      res = await doFetch();
    }
    // 404/410 = aviz not found / gone; 400 after retry = treat as no history.
    if (res.status === 400 || res.status === 404 || res.status === 410) return [];
    if (!res.ok) {
      const body = await readResponseTextWithCap(res, RNPM_MAX_RESPONSE_BYTES, composed).catch(() => "");
      throw new RnpmError(`Eroare RNPM istoric (${res.status}): ${body.slice(0, 200)}`, res.status);
    }
    const data = await readRnpmJson(res, composed);
    // Real response shape is { inscriere: string, istoric: Entry[] }.
    // Keep array + { entries } paths as tolerant fallbacks.
    if (data && Array.isArray((data as { istoric?: unknown }).istoric)) {
      return (data as { istoric: RnpmIstoricEntry[] }).istoric;
    }
    if (Array.isArray(data)) return data as RnpmIstoricEntry[];
    if (data && Array.isArray((data as { entries?: unknown }).entries)) {
      return (data as { entries: RnpmIstoricEntry[] }).entries;
    }
    return [];
  }

  async fetchFullDetail(uuid: string, signal?: AbortSignal): Promise<RnpmFullDetail> {
    const [p1, p2, p3, p4, istoric] = await Promise.all([
      this.fetchPart(uuid, 1, signal),
      this.fetchPart(uuid, 2, signal),
      this.fetchPart(uuid, 3, signal),
      this.fetchPart(uuid, 4, signal),
      this.fetchIstoric(uuid, signal),
    ]);
    return {
      part1: p1 as RnpmDetailPart1 | null,
      part2: p2 as RnpmDetailPart2 | null,
      part3: p3 as RnpmDetailPart3 | null,
      part4: p4 as RnpmDetailPart4 | null,
      istoric,
    };
  }

  async sleep(): Promise<void> {
    if (this.delayMs > 0) {
      await new Promise((r) => setTimeout(r, this.delayMs));
    }
  }
}

// Shared default instance — RnpmClient is stateless (no user-scoped data), safe as singleton.
// Avoids allocating a fresh client + fetch wrapper on every /search call.
export const defaultRnpmClient = new RnpmClient();

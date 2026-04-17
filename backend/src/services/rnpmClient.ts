export const RNPM_BASE_URL = "https://mj.rnpm.ro";

export type RnpmSearchType = "ipoteci" | "fiducii" | "specifice" | "creante" | "obligatiuni";

export interface SiSau { type: "1" | "2"; value: string }

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

export interface RnpmIdentificator { v: string; k: string | null }

export interface RnpmDocument {
  no: number;
  identificator: RnpmIdentificator;
  utilizatorAutorizat: string;
  data: string;
  tip: string;
  needsActualizare: boolean;
  activ?: boolean;
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
  activ?: boolean;
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
  [key: string]: unknown;
}

export interface RnpmDetailPartyPFDebitor extends RnpmDetailPartyPF { calitate?: string }
export interface RnpmDetailPartyPJDebitor extends RnpmDetailPartyPJ { calitate?: string }

export interface RnpmDetailPart2 {
  creditoriF?: RnpmDetailPartyPF[];
  creditoriJ?: RnpmDetailPartyPJ[];
  [key: string]: unknown;
}

export interface RnpmDetailPart3 {
  debitoriF?: RnpmDetailPartyPFDebitor[];
  debitoriJ?: RnpmDetailPartyPJDebitor[];
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

export interface RnpmDetailBunGroup { count?: number; bunuri?: RnpmDetailBun[] }
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
  constructor(message: string, status?: number, cause?: unknown) {
    super(message);
    this.name = "RnpmError";
    this.status = status;
    this.cause = cause;
  }
}

const DEFAULT_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "ro-RO,ro;q=0.9,en;q=0.8",
  "Origin": RNPM_BASE_URL,
  "Referer": `${RNPM_BASE_URL}/`,
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
};

export interface RnpmClientOptions {
  requestDelayMs?: number;
  fetchImpl?: typeof fetch;
}

export class RnpmClient {
  private readonly delayMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: RnpmClientOptions = {}) {
    this.delayMs = opts.requestDelayMs ?? 2000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async search(type: RnpmSearchType, params: RnpmSearchParams, page = 1, signal?: AbortSignal): Promise<RnpmSearchResult> {
    const url = `${RNPM_BASE_URL}/api/search/${type}/${page}`;
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: DEFAULT_HEADERS,
      body: JSON.stringify(params),
      signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new RnpmError(`Eroare RNPM search (${res.status}): ${body.slice(0, 200)}`, res.status);
    }
    return await res.json() as RnpmSearchResult;
  }

  async fetchPart(uuid: string, part: 1 | 2 | 3 | 4, signal?: AbortSignal): Promise<unknown> {
    const url = `${RNPM_BASE_URL}/api/view/inscriere/${uuid}?part=${part}`;
    const res = await this.fetchImpl(url, { headers: DEFAULT_HEADERS, signal });
    if (res.status === 400 || res.status === 404 || res.status === 410) return null;
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new RnpmError(`Eroare RNPM detail part ${part} (${res.status}): ${body.slice(0, 200)}`, res.status);
    }
    return await res.json();
  }

  async fetchIstoric(uuid: string, signal?: AbortSignal): Promise<RnpmIstoricEntry[]> {
    const url = `${RNPM_BASE_URL}/api/view/istoric/${uuid}`;
    const res = await this.fetchImpl(url, { headers: DEFAULT_HEADERS, signal });
    if (res.status === 400 || res.status === 404 || res.status === 410) return [];
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new RnpmError(`Eroare RNPM istoric (${res.status}): ${body.slice(0, 200)}`, res.status);
    }
    const data = await res.json();
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

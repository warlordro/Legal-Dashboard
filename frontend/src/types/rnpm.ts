export type RnpmSearchType = "ipoteci" | "fiducii" | "specifice" | "creante" | "obligatiuni";

export interface RnpmSiSau { type: "1" | "2"; value: string }

export interface RnpmSearchParams {
  identificatorInscriere?: string;
  tipInscriere?: RnpmSiSau;
  destinatieInscriere?: RnpmSiSau;
  activ?: boolean;
  nemodificat?: boolean;
  perioadaStart?: string;
  perioadaFinal?: string;
  tipAct?: string;
  nrAct?: RnpmSiSau;
  dataAct?: RnpmSiSau;
  creditorPJ?: { denumire?: string; regCom?: RnpmSiSau; CUI?: RnpmSiSau };
  CreditorPF?: { nume?: string; prenume?: RnpmSiSau; CNP?: RnpmSiSau };
  debitorPJ?: { denumire?: string; RegCom?: RnpmSiSau; CUI?: RnpmSiSau };
  debitorPF?: { nume?: string; prenume?: RnpmSiSau; CNP?: RnpmSiSau };
  bunV?: { model?: string; serieSasiu?: RnpmSiSau; serieMotor?: RnpmSiSau; nrImatriculare?: RnpmSiSau; descriere?: RnpmSiSau };
  bunA?: { categorie?: string; identificare?: RnpmSiSau; descriere?: string };
  parteJ?: { denumire?: string; RegCom?: RnpmSiSau; CUI?: RnpmSiSau };
  parteF?: { nume?: string; prenume?: RnpmSiSau; CNP?: RnpmSiSau };
  bunM?: { categorie?: string; identificare?: RnpmSiSau };
  tertPJ?: { denumire?: string; RegCom?: RnpmSiSau; CUI?: RnpmSiSau };
  tertPF?: { nume?: string; prenume?: RnpmSiSau; CNP?: RnpmSiSau };
  constituitorPJ?: { denumire?: string; RegCom?: RnpmSiSau; CUI?: RnpmSiSau };
  constituitorPF?: { nume?: string; prenume?: RnpmSiSau; CNP?: RnpmSiSau };
  fiduciar?: { denumire?: string; RegCom?: RnpmSiSau; CUI?: RnpmSiSau };
  beneficiarPJ?: { denumire?: string; RegCom?: RnpmSiSau; CUI?: RnpmSiSau };
  beneficiarPF?: { nume?: string; prenume?: RnpmSiSau; CNP?: RnpmSiSau };
  reprezentantCreditor?: { denumire?: string; regCom?: RnpmSiSau; CUI?: RnpmSiSau };
  debitorJ?: { denumire?: string; RegCom?: RnpmSiSau; CUI?: RnpmSiSau };
  debitorF?: { nume?: string; prenume?: RnpmSiSau; CNP?: RnpmSiSau };
  creante?: { descriere?: string };
  // Obligatiuni ipotecare — chei confirmate prin captura Network pe site-ul oficial RNPM.
  agentPJ?: { denumire?: string; RegCom?: RnpmSiSau; CUI?: RnpmSiSau };
  agentPF?: { nume?: string; prenume?: RnpmSiSau; CNP?: RnpmSiSau };
  emitent?: { denumire?: string; RegCom?: RnpmSiSau; CUI?: RnpmSiSau };
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

export interface RnpmSearchResponse {
  searchId: number;
  total: number;
  pagesTotal: number;
  pageSize: number;
  currentPage: number;
  criteriu: string;
  documents: RnpmDocument[];
  avizIds: (number | null)[];
  detailsFailed: string[];
  gcode: string;
  nextRnpmPage: number | null;
}

export interface RnpmAvizRecord {
  id: number;
  owner_id: string;
  uuid: string;
  identificator: string;
  search_type: string;
  tip: string;
  data: string;
  utilizator_autorizat: string | null;
  activ: number;
  needs_actualizare: number;
  destinatie: string | null;
  tip_act: string | null;
  numar_act: string | null;
  data_inreg: string | null;
  data_expirare: string | null;
  alte_mentiuni: string | null;
  detalii_comune: string | null;
  inscriere_initiala_id: string | null;
  inscriere_initiala_uuid: string | null;
  inscriere_modificata_id: string | null;
  inscriere_modificata_uuid: string | null;
  detail_fetched: number;
  search_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface RnpmParty {
  id: number;
  tip_persoana: string;
  calitate?: string | null;
  denumire: string | null;
  prenume: string | null;
  tip_entitate: string | null;
  sediu: string | null;
  nr_identificare: string | null;
  cod: string | null;
  cnp: string | null;
  tara: string | null;
  localitate: string | null;
  judet: string | null;
  cod_postal: string | null;
  alte_date: string | null;
  subscriptor: number | null;
  nr_ordine: number | null;
}

export interface RnpmBunPartyRef {
  rol: "constituitor" | "tert";
  tip_persoana: "PF" | "PJ";
  denumire: string | null;
  prenume?: string | null;
  tip_entitate?: string | null;
  sediu?: string | null;
  nr_identificare?: string | null;
  cod?: string | null;
  cnp?: string | null;
  tara?: string | null;
  localitate?: string | null;
  judet?: string | null;
  cod_postal?: string | null;
  alte_date?: string | null;
}

export interface RnpmBun {
  id: number;
  tip_bun: string;
  categorie: string | null;
  identificare: string | null;
  descriere: string | null;
  model: string | null;
  serie_sasiu: string | null;
  serie_motor: string | null;
  nr_inmatriculare: string | null;
  referinte: RnpmBunPartyRef[];
}

export interface RnpmIstoricEntry {
  id: number;
  identificator: string;
  uuid: string;
  data: string;
  tip: string;
  inscriere_m_v: string | null;
  inscriere_m_k: string | null;
}

export interface RnpmAvizFull {
  aviz: RnpmAvizRecord;
  creditori: RnpmParty[];
  debitori: RnpmParty[];
  bunuri: RnpmBun[];
  istoric: RnpmIstoricEntry[];
}

export interface RnpmCursorPage<T> {
  items: T[];
  nextCursor: number | null;
}

export interface RnpmStats {
  total: number;
  activ: number;
  inactiv: number;
  byType: Partial<Record<RnpmSearchType, number>>;
  db: { path: string; sizeBytes: number };
}

export interface RnpmSearchHistoryEntry {
  id: string;
  type: RnpmSearchType;
  params: RnpmSearchParams;
  label: string;
  resultCount: number;
  timestamp: number;
}

export interface RnpmBulkProgress {
  index: number;
  total: number;
  label: string;
  phase: "captcha" | "search" | "details" | "done" | "error";
  message?: string;
  resultCount?: number;
  searchId?: number;
  error?: string;
}

export interface RnpmBulkItem {
  type: RnpmSearchType;
  params: RnpmSearchParams;
  label?: string;
}

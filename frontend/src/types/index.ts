export interface DosarParte {
  calitateParte: string;
  nume: string;
}

export interface DosarSedinta {
  complet: string;
  data: string;
  ora: string;
  solutie: string;
  solutieSumar: string;
  documentSedinta: string;
  numarDocument: string;
  dataPronuntare: string;
}

export interface DosarCaleAtac {
  dataDeclarare: string;
  tipCaleAtac: string;
  parteDeclaratoare: string;
}

export interface Dosar {
  numar: string;
  data: string;
  institutie: string;
  departament: string;
  obiect: string;
  categorieCaz: string;
  stadiuProcesual: string;
  parti: DosarParte[];
  sedinte: DosarSedinta[];
  // ── ICCJ-only (undefined for PortalJust dosare) ──
  source?: "portaljust" | "iccj";
  iccjId?: string;
  numarVechi?: string;
  dataInitiala?: string;
  stadiulProcesualCombinat?: string;
  obiecteSecundare?: string;
  caiAtac?: DosarCaleAtac[];
}

export interface Termen {
  numarDosar: string;
  institutie: string;
  data: string;
  ora: string;
  complet: string;
  solutie: string;
  solutieSumar: string;
  categorieCaz?: string;
  stadiuProcesual?: string;
  obiect?: string;
  parti?: DosarParte[];
  // ICCJ-only (undefined for PortalJust termene)
  source?: DosarSource;
  iccjId?: string;
}

export type DosarSource = "portaljust" | "iccj";

export interface SearchParams {
  numarDosar?: string;
  obiectDosar?: string;
  numeParte?: string;
  institutie?: string | string[];
  dataStart?: string;
  dataStop?: string;
  categorii?: string[];
  stadii?: string[];
  // Search source toggle. Absent/"portaljust" = existing PortalJust SOAP path.
  source?: DosarSource;
  // ICCJ "Secție" filter (Department id, e.g. "157"); only used when source="iccj".
  sectie?: string;
}

export interface SearchHistoryEntry {
  id: string;
  type: "dosare" | "termene";
  params: SearchParams;
  label: string;
  resultCount: number;
  timestamp: number;
  meta?: { categoriesCount: number; institutiiCount: number };
}

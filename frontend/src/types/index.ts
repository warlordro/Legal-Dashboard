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
}

export interface SearchParams {
  numarDosar?: string;
  obiectDosar?: string;
  numeParte?: string;
  institutie?: string | string[];
  dataStart?: string;
  dataStop?: string;
  categorii?: string[];
  stadii?: string[];
}

export interface SearchHistoryEntry {
  id: string;
  type: "dosare" | "termene";
  params: SearchParams;
  label: string;
  resultCount: number;
  timestamp: number;
}

// ICCJ "Secție" filter options, mirrored verbatim from the live www.scj.ro
// search form (/738/Cautare-dosare-si-parti, Department dropdown) on 2026-06-06.
// The numeric `value` is the CMS Department id the search endpoint expects.
// Pattern mirrors frontend/src/lib/institutii.ts (PortalJust WSDL enum).

export interface IccjSectie {
  value: string;
  label: string;
}

// value "" = "Toate" (no filter). Kept first for the default option.
export const ICCJ_SECTII: IccjSectie[] = [
  { value: "", label: "Toate secțiile" },
  { value: "154", label: "Secția I civilă" },
  { value: "155", label: "Secția a II-a civilă" },
  { value: "157", label: "Secția Penală" },
  { value: "158", label: "Secția de Contencios Administrativ și Fiscal" },
  { value: "163", label: "Secțiile Unite" },
  { value: "182", label: "Completul de 9 Judecători" },
  { value: "183", label: "Completul de 9 judecători (Legea nr. 304/2004)" },
  { value: "190", label: "Completurile de 5 judecători" },
  { value: "202", label: "Completul pentru dezlegarea unor chestiuni de drept" },
  { value: "210", label: "Completul pentru soluționarea recursurilor în interesul legii" },
];

export function getIccjSectieLabel(value: string): string {
  return ICCJ_SECTII.find((s) => s.value === value)?.label ?? value;
}

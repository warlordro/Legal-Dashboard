// v2.20.3 Grupul O — backend canonical pentru sub-tipurile RNPM (tipInscriere)
// per categorie. Mirror exact al frontend/src/components/rnpm/rnpm-form-constants.ts
// (TIP_AVIZ_BY_CATEGORY). Pana in v2.20.2 backend-ul accepta orbeste lista trimisa
// de frontend, ceea ce permite frontend tampering / accidental drift sa schimbe
// indexarea 1-based pe care o foloseste RNPM (`tipInscriere.value = i+1`).
//
// Ruta /search-split valideaza ca `subTypeLabels` e prefixul exact al listei
// canonice pentru `type` (ordine + casing identice). Daca user-ul deselecteaza
// sub-tipuri din UI, frontend-ul re-trimite tot lista canonica si rezultatul
// e scopat ulterior la nivel UI; backend-ul nu permite o lista re-ordonata.
//
// IMPORTANT la sincronizare: orice modificare la frontend trebuie reflectata
// aici si invers — discrepanta produce 400 invalid_subtypes pe split.

import type { RnpmSearchType } from "./rnpmClient.ts";

export const TIP_AVIZ_BY_CATEGORY: Record<RnpmSearchType, readonly string[]> = {
  ipoteci: [
    "aviz initial", "cesiune a creantei", "extindere", "intentie", "modificator",
    "nulitate", "prelungire", "reducere", "stingere", "transformare", "executare",
    "preluare", "schimbarea rangului", "mentinere", "cesiunea rangului ipotecii",
    "reactivare", "actualizare", "indreptare a erorii materiale",
  ],
  specifice: [
    "aviz initial", "modificare", "stingere", "nulitate", "prelungire",
    "reactivare", "indreptare a erorii materiale",
  ],
  fiducii: [
    "aviz initial", "acceptare", "modificare", "nulitate", "stingere",
    "reactivare", "indreptare a erorii materiale",
  ],
  creante: [
    "aviz initial", "modificare", "extindere", "reducere", "stingere",
    "nulitate", "prelungire", "reactivare", "indreptare a erorii materiale",
  ],
  obligatiuni: [
    "aviz initial", "modificare", "extindere", "reducere", "stingere",
    "nulitate", "prelungire", "reactivare", "indreptare a erorii materiale",
  ],
};

// Verifica ca lista trimisa de frontend e prefixul EXACT al listei canonice
// pentru categoria respectiva. Frontend-ul trimite mereu lista completa (sau
// gol → respins separat in routes/rnpm.ts), dar lasam aici suport pentru un
// prefix in caz ca o iteratie viitoare permite split partial.
//
// Returneaza `null` daca e valid, altfel mesajul de eroare RO pentru envelope.
export function validateSubTypeLabels(type: RnpmSearchType, labels: string[]): string | null {
  const canonical = TIP_AVIZ_BY_CATEGORY[type];
  if (labels.length > canonical.length) {
    return `Lista sub-tipuri are ${labels.length} elemente, peste maximul de ${canonical.length} pentru ${type}.`;
  }
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== canonical[i]) {
      return `Sub-tip "${labels[i]}" la pozitia ${i} nu corespunde listei canonice "${canonical[i]}" pentru ${type}.`;
    }
  }
  return null;
}

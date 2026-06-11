// Mirror al id-urilor din frontend/src/lib/iccjSectii.ts (Department ids din
// formularul scj.ro /738, capturate 2026-06-06). Backend-ul valideaza doar
// id-urile; label-urile raman in frontend. "" = toate sectiile (fara filtru).
// La drift (scj.ro adauga/redenumeste sectii) actualizeaza AMBELE fisiere.
export const ICCJ_SECTII_IDS = new Set([
  "",
  "154",
  "155",
  "157",
  "158",
  "163",
  "182",
  "183",
  "190",
  "202",
  "210",
]);

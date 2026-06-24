import type { RnpmSearchType } from "./rnpmClient.ts";

// v2.18.0 — listele de destinatii enumerable per categorie. Mirror exact al
// frontend/src/components/rnpm/rnpm-form-constants.ts (DESTINATIE_IPOTECI,
// DESTINATIE_INSCRIERII). Sunt necesare pe backend pentru tier-2 split:
// cand un sub-tip din tipInscriere depaseste tot capul de 1500, iteram aici
// pe destinatieInscriere ca sa subdivizam si mai mult.
//
// IMPORTANT: RNPM asteapta destinatieInscriere.value ca **index 1-based** in
// aceasta lista (1, 2, ..., len), EXACT ca tipInscriere. Verificat empiric
// in 2026-05-07: trimiterea label-ului literal a returnat total: 0 pe toate
// cele 14 destinatii pentru un sub-tip cu 1822 records. Vezi comentariul
// din executeNestedDestinationSplit pentru context complet.
// (RnpmSearchForm.tsx:147 trimite literal label dar filtrul de destinatie e
// rar folosit de useri si bug-ul a ramas latent in form-ul oficial.)
//
// `creante`, `obligatiuni`, `fiducii` nu au lista de destinatii in UI-ul
// oficial -> nu intra in tier-2 si raman fail-clean (rejected) la limit_exceeded.

export const DESTINATII_IPOTECI = [
  "creditor garantat/debitor",
  "locatar/locator",
  "consignatar/consignant",
  "vanzator/cumparator",
  "obligatii agricole",
  "inscrieri in legatura cu finantele publice",
  "preluat de datoria publica",
  "alte inscrieri",
  "sechestru",
  "sechestru scutit de taxa",
];

export const DESTINATII_INSCRIERII = [
  "publicitatea clauzei de insesizabilitate",
  "publicitatea clauzei de inalienabilitate",
  "publicitatea clauzei de rezerva a proprietatii",
  "publicitatea pactului de rascumparare",
  "publicitatea cesiunii de creanta",
  "publicitatea declaratiei de rezolutiune",
  "publicitatea declaratiei de reziliere",
  "publicitatea hotararii judecatoresti privind actele de dispozitie care pun in pericol grav interesele familiei",
  "publicitatea regimului matrimonial",
  "publicitatea uzufructului asupra creantelor",
  "publicitatea platii anticipate a chiriei",
  "publicitatea cesiunii creantei privind chiria",
  "publicitatea titlurilor executorii constatate prin inscrisuri sub semnatura privata",
  "alte acte/fapte juridice supuse publicitatii conform legii",
];

export const DESTINATII_BY_CATEGORY: Partial<Record<RnpmSearchType, string[]>> = {
  ipoteci: DESTINATII_IPOTECI,
  specifice: DESTINATII_INSCRIERII,
};

export function hasNestedDestinations(type: RnpmSearchType): boolean {
  const destinations = DESTINATII_BY_CATEGORY[type];
  return Array.isArray(destinations) && destinations.length > 0;
}

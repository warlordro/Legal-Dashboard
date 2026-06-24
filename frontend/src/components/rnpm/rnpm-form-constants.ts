import type { RnpmSearchType } from "@/types/rnpm";

// Bun "Alt tip" la ipoteci — RNPM trimite `bunA.categorie` ca index string (1..11)
// in ordinea din dropdown-ul oficial. Confirmat prin captura Network: "recolte" = "6".
export const BUN_ALT_TIP_CATEGORII = [
  "creante conf. art. 2389 lit. a) si b) din Codul civil",
  "cont bancar",
  "actiuni/parti sociale/valori mobiliare/alte instrumente financiare",
  "echipamente/instalatii/alte bunuri destinate sa serveasca exploatarii unei intreprinderi",
  "polite de asigurare",
  "recolte",
  "utilaje agricole, altele decat autovehicule",
  "efective de animale",
  "universalitati",
  "inscriere veche",
  "alte bunuri",
];

export const DESTINATIE_IPOTECI = [
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

export const DESTINATIE_INSCRIERII = [
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

export const TIP_AVIZ_BY_CATEGORY: Record<RnpmSearchType, string[]> = {
  ipoteci: [
    "aviz initial",
    "cesiune a creantei",
    "extindere",
    "intentie",
    "modificator",
    "nulitate",
    "prelungire",
    "reducere",
    "stingere",
    "transformare",
    "executare",
    "preluare",
    "schimbarea rangului",
    "mentinere",
    "cesiunea rangului ipotecii",
    "reactivare",
    "actualizare",
    "indreptare a erorii materiale",
  ],
  specifice: [
    "aviz initial",
    "modificare",
    "stingere",
    "nulitate",
    "prelungire",
    "reactivare",
    "indreptare a erorii materiale",
  ],
  fiducii: [
    "aviz initial",
    "acceptare",
    "modificare",
    "nulitate",
    "stingere",
    "reactivare",
    "indreptare a erorii materiale",
  ],
  creante: [
    "aviz initial",
    "modificare",
    "extindere",
    "reducere",
    "stingere",
    "nulitate",
    "prelungire",
    "reactivare",
    "indreptare a erorii materiale",
  ],
  obligatiuni: [
    "aviz initial",
    "modificare",
    "extindere",
    "reducere",
    "stingere",
    "nulitate",
    "prelungire",
    "reactivare",
    "indreptare a erorii materiale",
  ],
};

// Label-ul dropdown-ului de tip difera per categorie pe site-ul RNPM oficial.
export const TIP_LABEL_BY_CATEGORY: Record<RnpmSearchType, string> = {
  ipoteci: "Tipul inregistrarii",
  creante: "Tipul inregistrarii",
  fiducii: "Tipul fiduciei",
  specifice: "Tipul avizului",
  obligatiuni: "Tipul avizului",
};

export const CATEGORIES: { type: RnpmSearchType; label: string }[] = [
  { type: "ipoteci", label: "Aviz de ipoteca mobiliara" },
  { type: "fiducii", label: "Fiducie" },
  { type: "specifice", label: "Aviz specific" },
  { type: "creante", label: "Aviz de ipoteca - creante securitizate" },
  { type: "obligatiuni", label: "Aviz de ipoteca - obligatiuni ipotecare" },
];

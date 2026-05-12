// Pure mapping helpers for RNPM detail responses → avizRepository SaveAvizInput.
// Extracted from rnpmSearchService so the service can stay focused on
// orchestration (captcha, retries, pagination, timing) and so the mappers can
// be unit-tested without spinning up SQLite.
//
// No DB writes here. Behavior MUST stay identical to the original inline
// implementation — any change to the mapping shape can corrupt persisted avize.

import type {
  RnpmDocument,
  RnpmFullDetail,
  RnpmDetailPartyPF,
  RnpmDetailPartyPJ,
  RnpmDetailBun,
  RnpmDetailBunBucket,
} from "./rnpmClient.ts";
import type { PartyInput, BunInput, BunPartyRef, IstoricInput, SaveAvizInput } from "../db/avizRepository.ts";

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

// Specifice: calitate generica ("Alta calitate") + altaCalitate (textul specific).
// Le combinam intr-un singur string pentru afisarea in tab-ul Debitori, unde
// specifice-ul isi mapeaza partile.
function formatCalitate(calitate: string | null | undefined, altaCalitate: string | null | undefined): string | null {
  if (altaCalitate) return calitate ? `${calitate}: ${altaCalitate}` : altaCalitate;
  return calitate ?? null;
}

function mapPartyPF(p: RnpmDetailPartyPF): PartyInput {
  return {
    tip_persoana: "PF",
    denumire: p.nume ?? null,
    prenume: p.prenume ?? null,
    tip_entitate: null,
    sediu: p.sediu ?? null,
    nr_identificare: null,
    cod: null,
    cnp: p.cnp ?? null,
    tara: p.tara ?? null,
    localitate: p.localitate ?? null,
    judet: p.judet ?? null,
    cod_postal: p.codPostal ?? null,
    alte_date: p.alteDate ?? null,
    subscriptor: p.subscriptor == null ? null : p.subscriptor ? 1 : 0,
    nr_ordine: p.no ?? null,
  };
}

function mapPartyPJ(p: RnpmDetailPartyPJ): PartyInput {
  return {
    tip_persoana: "PJ",
    denumire: p.denumire ?? null,
    prenume: null,
    tip_entitate: p.tip ?? null,
    sediu: p.sediu ?? null,
    nr_identificare: p.nrIdentificare ?? null,
    cod: p.cod ?? null,
    cnp: null,
    tara: p.tara ?? null,
    localitate: p.localitate ?? null,
    judet: p.judet ?? null,
    cod_postal: p.codPostal ?? null,
    alte_date: p.alteDate ?? null,
    subscriptor: p.subscriptor == null ? null : p.subscriptor ? 1 : 0,
    nr_ordine: p.no ?? null,
  };
}

function refFromPF(rol: "constituitor" | "tert", p: RnpmDetailPartyPF): BunPartyRef {
  return {
    rol,
    tip_persoana: "PF",
    denumire: p.nume ?? null,
    prenume: p.prenume ?? null,
    sediu: p.sediu ?? null,
    cnp: p.cnp ?? null,
    tara: p.tara ?? null,
    localitate: p.localitate ?? null,
    judet: p.judet ?? null,
    cod_postal: p.codPostal ?? null,
    alte_date: p.alteDate ?? null,
  };
}

function refFromPJ(rol: "constituitor" | "tert", p: RnpmDetailPartyPJ): BunPartyRef {
  return {
    rol,
    tip_persoana: "PJ",
    denumire: p.denumire ?? null,
    tip_entitate: p.tip ?? null,
    sediu: p.sediu ?? null,
    nr_identificare: p.nrIdentificare ?? null,
    cod: p.cod ?? null,
    tara: p.tara ?? null,
    localitate: p.localitate ?? null,
    judet: p.judet ?? null,
    cod_postal: p.codPostal ?? null,
    alte_date: p.alteDate ?? null,
  };
}

function mapBun(
  b: RnpmDetailBun,
  tip: "vehicul" | "mobil" | "alt",
  debitoriF: RnpmDetailPartyPF[] = [],
  debitoriJ: RnpmDetailPartyPJ[] = []
): BunInput {
  const refs: BunPartyRef[] = [];
  for (const idx of b.constituitoriF ?? []) {
    const p = debitoriF[idx - 1];
    if (p) refs.push(refFromPF("constituitor", p));
  }
  for (const idx of b.constituitoriJ ?? []) {
    const p = debitoriJ[idx - 1];
    if (p) refs.push(refFromPJ("constituitor", p));
  }
  for (const p of b.tertiF ?? []) refs.push(refFromPF("tert", p));
  for (const p of b.tertiJ ?? []) refs.push(refFromPJ("tert", p));
  return {
    tip_bun: tip,
    categorie: b.categorie ?? null,
    identificare: b.identificare ?? null,
    descriere: b.descriere ?? null,
    model: b.model ?? null,
    serie_sasiu: b.serieSasiu ?? null,
    serie_motor: b.serieMotor ?? null,
    nr_inmatriculare: b.nrInmatriculare ?? null,
    referinte: refs,
  };
}

function flattenBucket(bucket: RnpmDetailBunBucket | undefined): RnpmDetailBun[] {
  if (!bucket) return [];
  if (Array.isArray(bucket)) return bucket;
  return Object.values(bucket).flatMap((g) => (Array.isArray(g?.bunuri) ? g.bunuri : []));
}

export function buildSaveAvizInput(
  doc: RnpmDocument,
  detail: RnpmFullDetail,
  searchType: string,
  ownerId: string,
  searchId: number
): SaveAvizInput {
  const part1 = detail.part1 ?? {};
  const part2 = detail.part2 ?? {};
  const part3 = detail.part3 ?? {};
  const part4 = detail.part4 ?? {};

  let creditori: PartyInput[] = [];
  let debitori: PartyInput[] = [];
  let bunuri: BunInput[] = [];

  if (searchType === "specifice") {
    // Specifice: part2 contine partiF/partiJ (bucket unic cu calitate+altaCalitate),
    // part3 contine { bunuri: [{ no, descriere }] }, part4 = null.
    // Mapam toate partile in "debitori" (schema are coloana calitate) — creditori raman goale.
    debitori = [
      ...arr<RnpmDetailPartyPF>(part2.partiF).map((p) => ({
        ...mapPartyPF(p),
        calitate: formatCalitate(p.calitate, p.altaCalitate),
      })),
      ...arr<RnpmDetailPartyPJ>(part2.partiJ).map((p) => ({
        ...mapPartyPJ(p),
        calitate: formatCalitate(p.calitate, p.altaCalitate),
      })),
    ];
    bunuri = arr<RnpmDetailBun & { descriere?: string }>(part3.bunuri).map((b) => ({
      tip_bun: "alt",
      categorie: null,
      identificare: null,
      descriere: b.descriere ?? null,
      model: null,
      serie_sasiu: null,
      serie_motor: null,
      nr_inmatriculare: null,
      referinte: [],
    }));
  } else {
    creditori = [
      ...arr<RnpmDetailPartyPF>(part2.creditoriF).map((p) => mapPartyPF(p)),
      ...arr<RnpmDetailPartyPJ>(part2.creditoriJ).map((p) => mapPartyPJ(p)),
    ];

    debitori = [
      ...arr<RnpmDetailPartyPF & { calitate?: string }>(part3.debitoriF).map((p) => ({
        ...mapPartyPF(p),
        calitate: p.calitate ?? null,
      })),
      ...arr<RnpmDetailPartyPJ & { calitate?: string }>(part3.debitoriJ).map((p) => ({
        ...mapPartyPJ(p),
        calitate: p.calitate ?? null,
      })),
    ];

    const debitoriF = arr<RnpmDetailPartyPF & { calitate?: string }>(part3.debitoriF);
    const debitoriJ = arr<RnpmDetailPartyPJ & { calitate?: string }>(part3.debitoriJ);
    bunuri = [
      ...flattenBucket(part4.vehicule).map((b) => mapBun(b, "vehicul", debitoriF, debitoriJ)),
      ...flattenBucket(part4.mobile).map((b) => mapBun(b, "mobil", debitoriF, debitoriJ)),
      ...flattenBucket(part4.alte).map((b) => mapBun(b, "alt", debitoriF, debitoriJ)),
    ];
  }

  const istoric: IstoricInput[] = arr<{
    identificator?: { v?: string; k?: string };
    data?: string;
    tip?: string;
    inscriereM?: { v?: string; k?: string };
  }>(detail.istoric).map((h) => ({
    identificator: h.identificator?.v ?? "",
    uuid: h.identificator?.k ?? "",
    data: h.data ?? "",
    tip: h.tip ?? "",
    inscriere_m_v: h.inscriereM?.v ?? null,
    inscriere_m_k: h.inscriereM?.k ?? null,
  }));

  return {
    ownerId,
    searchId,
    uuid: doc.identificator.k ?? "",
    identificator: doc.identificator.v,
    searchType,
    tip: doc.tip,
    data: doc.data,
    utilizatorAutorizat: doc.utilizatorAutorizat ?? null,
    activ: typeof part1.activ === "boolean" ? part1.activ : typeof doc.activ === "boolean" ? doc.activ : null,
    needsActualizare: doc.needsActualizare === true,
    destinatie: part1.destinatie ?? null,
    tipAct: part1.tipAct ?? null,
    numarAct: part1.numar ?? null,
    dataInreg: part1.dataInreg ?? null,
    dataExpirare: part1.dataExpirare ?? null,
    alteMentiuni: typeof part1.alteMentiuni === "string" ? part1.alteMentiuni : null,
    detaliiComune: part4.detaliiComune ?? null,
    inscriereInitialaId: part1.inscriereInitiala?.v ?? null,
    inscriereInitialaUuid: part1.inscriereInitiala?.k ?? null,
    inscriereModificataId: part1.inscriereModificata?.v ?? null,
    inscriereModificataUuid: part1.inscriereModificata?.k ?? null,
    detailFetched: true,
    creditori,
    debitori,
    bunuri,
    istoric,
  };
}

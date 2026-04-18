import { solveRnpmCaptcha, type CaptchaProvider, type CaptchaMode } from "./captchaSolver.ts";
import {
  RnpmClient,
  defaultRnpmClient,
  RnpmError,
  type RnpmSearchType,
  type RnpmSearchParams,
  type RnpmDocument,
  type RnpmFullDetail,
  type RnpmDetailPartyPF,
  type RnpmDetailPartyPJ,
  type RnpmDetailBun,
  type RnpmDetailBunBucket,
} from "./rnpmClient.ts";
import { saveSearch } from "../db/searchRepository.ts";
import {
  saveAvizFull,
  type PartyInput,
  type BunInput,
  type IstoricInput,
  type BunPartyRef,
} from "../db/avizRepository.ts";
import { stripDiacriticsDeep } from "../util/textNormalize.ts";

export interface ExecuteSearchInput {
  type: RnpmSearchType;
  params: Omit<RnpmSearchParams, "gcode">;
  captchaKey: string;
  captchaProvider?: CaptchaProvider;
  fallback2CaptchaKey?: string;
  captchaMode?: CaptchaMode;
  ownerId?: string;
  startRnpmPage?: number;
  batchSize?: number;
  existingGcode?: string;
  existingSearchId?: number;
  fetchDetails?: boolean;
  detailConcurrency?: number;
  signal?: AbortSignal;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

export interface ExecuteSearchResult {
  searchId: number;
  documents: RnpmDocument[];
  avizIds: (number | null)[];
  detailsFailed: string[];
  total: number;
  pagesTotal: number;
  pageSize: number;
  currentPage: number;
  criteriu: string;
  gcode: string;
  nextRnpmPage: number | null;
}

const DEFAULT_DETAIL_CONCURRENCY = 7;
const DEFAULT_BATCH_SIZE = 25;

function toRnpmDate(s: string): string {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
}

export async function executeSearch(
  input: ExecuteSearchInput,
  client: RnpmClient = defaultRnpmClient
): Promise<ExecuteSearchResult> {
  const ownerId = input.ownerId ?? "local";
  const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
  const fetchDetails = input.fetchDetails !== false;
  const concurrency = input.detailConcurrency ?? DEFAULT_DETAIL_CONCURRENCY;
  const signal = input.signal;
  let rnpmPage = input.startRnpmPage ?? 1;

  throwIfAborted(signal);
  let gcode = input.existingGcode ?? await solveRnpmCaptcha(input.captchaKey, input.captchaProvider, input.fallback2CaptchaKey, signal, input.captchaMode);
  throwIfAborted(signal);
  // perioadaStart/perioadaFinal sunt filtre client-side (RNPM nu suporta interval pe majoritatea categoriilor)
  const { perioadaStart: _ps, perioadaFinal: _pf, ...restParams } = input.params;
  // RNPM backend nu gaseste nimic cu diacritice — folosim doar pentru request-ul efectiv.
  // input.params ramane neatins pentru ca `rnpm_searches.params_json` sa pastreze textul original al userului.
  const searchParams: RnpmSearchParams = { ...stripDiacriticsDeep(restParams), gcode };
  void _ps; void _pf;

  let firstResult;
  // PRIVACY: do NOT log parameter values (CUI, CNP, nume, sedii). Log only
  // the shape of the request so we can correlate issues without leaking PII.
  const { gcode: _g, ...logParams } = searchParams;
  const fieldsPresent = Object.entries(logParams)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k]) => k)
    .join(",");
  console.log(`[rnpm] search type=${input.type} page=${rnpmPage} fields=[${fieldsPresent}]`);
  try {
    firstResult = await client.search(input.type, searchParams, rnpmPage, signal);
    // criteriu is the site's echo of the user's inputs — also PII. Log only total + pages.
    console.log(`[rnpm] result total=${firstResult.total} pages=${firstResult.pagesTotal}`);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    const isExpired = e instanceof RnpmError && (e.status === 410 || e.status === 401 || e.status === 403);
    if ((input.existingGcode && e instanceof RnpmError) || isExpired) {
      throwIfAborted(signal);
      gcode = await solveRnpmCaptcha(input.captchaKey, input.captchaProvider, input.fallback2CaptchaKey, signal, input.captchaMode);
      searchParams.gcode = gcode;
      firstResult = await client.search(input.type, searchParams, rnpmPage, signal);
    } else {
      throw e;
    }
  }

  if (firstResult.total > 1500 || !Array.isArray(firstResult.documents)) {
    throw new RnpmError(
      `RNPM a returnat ${firstResult.total} rezultate (limita 1500). Restrange criteriile de cautare.`,
      400
    );
  }
  const pagesTotal = firstResult.pagesTotal;
  const total = firstResult.total;
  const pageSize = firstResult.pageSize;
  const criteriu = firstResult.criteriu;

  const searchId = input.existingSearchId ?? saveSearch({
    ownerId,
    searchType: input.type,
    paramsJson: JSON.stringify(input.params),
    totalResults: total,
    criteriu: criteriu ?? null,
  });

  const allDocs: RnpmDocument[] = [];
  const avizIds: (number | null)[] = [];
  const detailsFailed: string[] = [];

  const processPage = async (docs: RnpmDocument[]) => {
    const baseIdx = allDocs.length;
    allDocs.push(...docs);
    for (let i = 0; i < docs.length; i++) avizIds.push(null);
    if (!fetchDetails || docs.length === 0) return;
    for (let i = 0; i < docs.length; i += concurrency) {
      throwIfAborted(signal);
      const batchResults = await Promise.all(docs.slice(i, i + concurrency).map(async (doc, batchIdx) => {
        const localIdx = i + batchIdx;
        if (!doc.identificator.k) return { localIdx, doc, ok: false as const };
        try {
          const detail = await client.fetchFullDetail(doc.identificator.k, signal);
          // Fetch-ul poate sa se fi intors inainte ca abort-ul sa-l ajunga.
          // Verificam explicit ca sa nu scriem in SQLite dupa ce user-ul a oprit cautarea.
          if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
          if (typeof detail.part1?.activ === "boolean") doc.activ = detail.part1.activ;
          const avizId = persistAvizWithDetail(doc, detail, input.type, ownerId, searchId);
          return { localIdx, doc, ok: true as const, avizId };
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") throw e;
          console.error(`[rnpm detail fail] ${doc.identificator.v}:`, e instanceof Error ? e.message : e);
          return { localIdx, doc, ok: false as const };
        }
      }));
      for (const r of batchResults) {
        if (r.ok) avizIds[baseIdx + r.localIdx] = r.avizId;
        else detailsFailed.push(r.doc.identificator.v);
      }
    }
  };

  await processPage(firstResult.documents);
  rnpmPage++;

  while (allDocs.length < batchSize && rnpmPage <= pagesTotal) {
    throwIfAborted(signal);
    let r;
    try {
      r = await client.search(input.type, searchParams, rnpmPage, signal);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      if (e instanceof RnpmError && (e.status === 410 || e.status === 401 || e.status === 403)) {
        throwIfAborted(signal);
        gcode = await solveRnpmCaptcha(input.captchaKey, input.captchaProvider, input.fallback2CaptchaKey, signal, input.captchaMode);
        searchParams.gcode = gcode;
        r = await client.search(input.type, searchParams, rnpmPage, signal);
      } else {
        throw e;
      }
    }
    await processPage(r.documents);
    rnpmPage++;
  }

  const nextRnpmPage = rnpmPage <= pagesTotal ? rnpmPage : null;

  return {
    searchId,
    documents: allDocs,
    avizIds,
    detailsFailed,
    total,
    pagesTotal,
    pageSize,
    currentPage: input.startRnpmPage ?? 1,
    criteriu,
    gcode,
    nextRnpmPage,
  };
}

function persistAvizWithDetail(
  doc: RnpmDocument,
  detail: RnpmFullDetail,
  searchType: string,
  ownerId: string,
  searchId: number
): number {
  const part1 = detail.part1 ?? {};
  const part2 = detail.part2 ?? {};
  const part3 = detail.part3 ?? {};
  const part4 = detail.part4 ?? {};

  const arr = <T,>(v: unknown): T[] => Array.isArray(v) ? (v as T[]) : [];

  let creditori: PartyInput[] = [];
  let debitori: PartyInput[] = [];
  let bunuri: BunInput[] = [];

  if (searchType === "specifice") {
    // Specifice: part2 contine partiF/partiJ (bucket unic cu calitate+altaCalitate),
    // part3 contine { bunuri: [{ no, descriere }] }, part4 = null.
    // Mapam toate partile in "debitori" (schema are coloana calitate) — creditori raman goale.
    debitori = [
      ...arr<RnpmDetailPartyPF>(part2.partiF).map((p) => ({ ...mapPartyPF(p), calitate: formatCalitate(p.calitate, p.altaCalitate) })),
      ...arr<RnpmDetailPartyPJ>(part2.partiJ).map((p) => ({ ...mapPartyPJ(p), calitate: formatCalitate(p.calitate, p.altaCalitate) })),
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
      ...arr<RnpmDetailPartyPF & { calitate?: string }>(part3.debitoriF).map((p) => ({ ...mapPartyPF(p), calitate: p.calitate ?? null })),
      ...arr<RnpmDetailPartyPJ & { calitate?: string }>(part3.debitoriJ).map((p) => ({ ...mapPartyPJ(p), calitate: p.calitate ?? null })),
    ];

    const flattenBucket = (bucket: RnpmDetailBunBucket | undefined): RnpmDetailBun[] => {
      if (!bucket) return [];
      if (Array.isArray(bucket)) return bucket;
      return Object.values(bucket).flatMap((g) => Array.isArray(g?.bunuri) ? g.bunuri : []);
    };
    const debitoriF = arr<RnpmDetailPartyPF & { calitate?: string }>(part3.debitoriF);
    const debitoriJ = arr<RnpmDetailPartyPJ & { calitate?: string }>(part3.debitoriJ);
    bunuri = [
      ...flattenBucket(part4.vehicule).map((b) => mapBun(b, "vehicul", debitoriF, debitoriJ)),
      ...flattenBucket(part4.mobile).map((b) => mapBun(b, "mobil", debitoriF, debitoriJ)),
      ...flattenBucket(part4.alte).map((b) => mapBun(b, "alt", debitoriF, debitoriJ)),
    ];
  }

  const istoric: IstoricInput[] = arr<{ identificator?: { v?: string; k?: string }; data?: string; tip?: string; inscriereM?: { v?: string; k?: string } }>(detail.istoric).map((h) => ({
    identificator: h.identificator?.v ?? "",
    uuid: h.identificator?.k ?? "",
    data: h.data ?? "",
    tip: h.tip ?? "",
    inscriere_m_v: h.inscriereM?.v ?? null,
    inscriere_m_k: h.inscriereM?.k ?? null,
  }));

  return saveAvizFull({
    ownerId,
    searchId,
    uuid: doc.identificator.k ?? "",
    identificator: doc.identificator.v,
    searchType,
    tip: doc.tip,
    data: doc.data,
    utilizatorAutorizat: doc.utilizatorAutorizat ?? null,
    activ: typeof part1.activ === "boolean" ? part1.activ : (doc.activ ?? true),
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
  });
}

// Specifice: calitate generica ("Alta calitate") + altaCalitate (textul specific).
// Le combinam intr-un singur string pentru afisarea in tab-ul Debitori, unde specifice-ul isi mapeaza partile.
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
    subscriptor: p.subscriptor == null ? null : (p.subscriptor ? 1 : 0),
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
    subscriptor: p.subscriptor == null ? null : (p.subscriptor ? 1 : 0),
    nr_ordine: p.no ?? null,
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

function refFromPF(rol: "constituitor" | "tert", p: RnpmDetailPartyPF): BunPartyRef {
  return {
    rol, tip_persoana: "PF",
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
    rol, tip_persoana: "PJ",
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

export interface BulkSearchItem {
  type: RnpmSearchType;
  params: Omit<RnpmSearchParams, "gcode">;
  label?: string;
}

export interface BulkProgress {
  index: number;
  total: number;
  label: string;
  phase: "captcha" | "search" | "details" | "done" | "error";
  message?: string;
  resultCount?: number;
  searchId?: number;
  error?: string;
}

export async function executeBulkSearch(
  items: BulkSearchItem[],
  captchaKey: string,
  ownerId: string,
  onProgress: (p: BulkProgress) => void,
  client: RnpmClient = defaultRnpmClient,
  signal?: AbortSignal,
  captchaProvider?: CaptchaProvider,
  fallback2CaptchaKey?: string,
  captchaMode?: CaptchaMode,
): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    if (signal?.aborted) return;
    const item = items[i];
    const label = item.label ?? describeItem(item);
    onProgress({ index: i, total: items.length, label, phase: "captcha" });
    try {
      onProgress({ index: i, total: items.length, label, phase: "search" });
      // Bulk items fetch toate paginile automat (limita RNPM = 1500). Single search foloseste batchSize=25
      // plus butonul "Incarca mai multe"; bulk nu are echivalent, deci se comporta ca "fetch all".
      const result = await executeSearch(
        { type: item.type, params: item.params, captchaKey, captchaProvider, fallback2CaptchaKey, captchaMode, ownerId, batchSize: 1500, signal },
        client
      );
      onProgress({
        index: i, total: items.length, label, phase: "done",
        resultCount: result.documents.length,
        searchId: result.searchId,
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      const msg = e instanceof Error ? e.message : String(e);
      onProgress({ index: i, total: items.length, label, phase: "error", error: msg });
    }
  }
}

function describeItem(item: BulkSearchItem): string {
  const p = item.params;
  if (p.debitorPJ?.CUI?.value) return `Debitor PJ CUI ${p.debitorPJ.CUI.value}`;
  if (p.debitorPF?.CNP?.value) return `Debitor PF CNP ${p.debitorPF.CNP.value}`;
  if (p.debitorPJ?.denumire) return `Debitor PJ ${p.debitorPJ.denumire}`;
  if (p.debitorPF?.nume) return `Debitor PF ${p.debitorPF.nume}`;
  if (p.identificatorInscriere) return p.identificatorInscriere;
  return `${item.type} search`;
}

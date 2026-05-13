import { getDb, checkpointWal } from "./schema.ts";
import { buildRnpmLikePattern } from "../util/textNormalize.ts";

export interface AvizRecord {
  id: number;
  owner_id: string;
  uuid: string;
  identificator: string;
  search_type: string;
  tip: string;
  data: string;
  utilizator_autorizat: string | null;
  activ: number | null;
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

export interface PartyRecord {
  id: number;
  owner_id: string;
  aviz_id: number;
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

export interface BunPartyRef {
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

export interface BunRecord {
  id: number;
  owner_id: string;
  aviz_id: number;
  tip_bun: string;
  categorie: string | null;
  identificare: string | null;
  descriere: string | null;
  model: string | null;
  serie_sasiu: string | null;
  serie_motor: string | null;
  nr_inmatriculare: string | null;
  referinte: BunPartyRef[];
}

export interface IstoricRecord {
  id: number;
  owner_id: string;
  aviz_id: number;
  identificator: string;
  uuid: string;
  data: string;
  tip: string;
  inscriere_m_v: string | null;
  inscriere_m_k: string | null;
}

export interface AvizFull {
  aviz: AvizRecord;
  creditori: PartyRecord[];
  debitori: PartyRecord[];
  bunuri: BunRecord[];
  istoric: IstoricRecord[];
}

export interface UpsertAvizInput {
  ownerId?: string;
  searchId?: number | null;
  uuid: string;
  identificator: string;
  searchType: string;
  tip: string;
  data: string;
  utilizatorAutorizat?: string | null;
  activ?: boolean | null;
  needsActualizare?: boolean;
  destinatie?: string | null;
  tipAct?: string | null;
  numarAct?: string | null;
  dataInreg?: string | null;
  dataExpirare?: string | null;
  alteMentiuni?: string | null;
  detaliiComune?: string | null;
  inscriereInitialaId?: string | null;
  inscriereInitialaUuid?: string | null;
  inscriereModificataId?: string | null;
  inscriereModificataUuid?: string | null;
  detailFetched?: boolean;
}

export type PartyInput = Omit<PartyRecord, "id" | "owner_id" | "aviz_id">;
export type BunInput = Omit<BunRecord, "id" | "owner_id" | "aviz_id">;
export type IstoricInput = Omit<IstoricRecord, "id" | "owner_id" | "aviz_id">;

export interface SaveAvizInput extends UpsertAvizInput {
  creditori?: PartyInput[];
  debitori?: PartyInput[];
  bunuri?: BunInput[];
  istoric?: IstoricInput[];
}

function serializeActiv(activ: boolean | null | undefined): 0 | 1 | null {
  if (activ === true) return 1;
  if (activ === false) return 0;
  return null;
}

export function saveAvizFull(input: SaveAvizInput): number {
  const db = getDb();
  const ownerId = input.ownerId ?? "local";

  const run = db.transaction((): number => {
    const existing = db
      .prepare("SELECT id FROM rnpm_avize WHERE owner_id = ? AND identificator = ?")
      .get(ownerId, input.identificator) as { id: number } | undefined;

    let avizId: number;
    if (existing) {
      avizId = existing.id;
      db.prepare(`
        UPDATE rnpm_avize SET
          uuid = ?, search_type = ?, tip = ?, data = ?, utilizator_autorizat = ?,
          activ = ?, needs_actualizare = ?, destinatie = ?, tip_act = ?, numar_act = ?,
          data_inreg = ?, data_expirare = ?, alte_mentiuni = ?, detalii_comune = ?,
          inscriere_initiala_id = ?, inscriere_initiala_uuid = ?,
          inscriere_modificata_id = ?, inscriere_modificata_uuid = ?,
          detail_fetched = ?, search_id = COALESCE(?, search_id), updated_at = datetime('now')
        WHERE id = ?
      `).run(
        input.uuid,
        input.searchType,
        input.tip,
        input.data,
        input.utilizatorAutorizat ?? null,
        serializeActiv(input.activ),
        input.needsActualizare ? 1 : 0,
        input.destinatie ?? null,
        input.tipAct ?? null,
        input.numarAct ?? null,
        input.dataInreg ?? null,
        input.dataExpirare ?? null,
        input.alteMentiuni ?? null,
        input.detaliiComune ?? null,
        input.inscriereInitialaId ?? null,
        input.inscriereInitialaUuid ?? null,
        input.inscriereModificataId ?? null,
        input.inscriereModificataUuid ?? null,
        input.detailFetched ? 1 : 0,
        input.searchId ?? null,
        avizId
      );
      db.prepare("DELETE FROM rnpm_creditori WHERE aviz_id = ?").run(avizId);
      db.prepare("DELETE FROM rnpm_debitori WHERE aviz_id = ?").run(avizId);
      db.prepare("DELETE FROM rnpm_bunuri WHERE aviz_id = ?").run(avizId);
      db.prepare("DELETE FROM rnpm_istoric WHERE aviz_id = ?").run(avizId);
    } else {
      const res = db
        .prepare(`
        INSERT INTO rnpm_avize (
          owner_id, uuid, identificator, search_type, tip, data, utilizator_autorizat,
          activ, needs_actualizare, destinatie, tip_act, numar_act, data_inreg, data_expirare,
          alte_mentiuni, detalii_comune, inscriere_initiala_id, inscriere_initiala_uuid,
          inscriere_modificata_id, inscriere_modificata_uuid,
          detail_fetched, search_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
        .run(
          ownerId,
          input.uuid,
          input.identificator,
          input.searchType,
          input.tip,
          input.data,
          input.utilizatorAutorizat ?? null,
          serializeActiv(input.activ),
          input.needsActualizare ? 1 : 0,
          input.destinatie ?? null,
          input.tipAct ?? null,
          input.numarAct ?? null,
          input.dataInreg ?? null,
          input.dataExpirare ?? null,
          input.alteMentiuni ?? null,
          input.detaliiComune ?? null,
          input.inscriereInitialaId ?? null,
          input.inscriereInitialaUuid ?? null,
          input.inscriereModificataId ?? null,
          input.inscriereModificataUuid ?? null,
          input.detailFetched ? 1 : 0,
          input.searchId ?? null
        );
      avizId = Number(res.lastInsertRowid);
    }

    const insertCreditor = db.prepare(`
      INSERT INTO rnpm_creditori (owner_id, aviz_id, tip_persoana, denumire, prenume, tip_entitate, sediu, nr_identificare, cod, cnp, tara, localitate, judet, cod_postal, alte_date, subscriptor, nr_ordine)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of input.creditori ?? []) {
      insertCreditor.run(
        ownerId,
        avizId,
        c.tip_persoana,
        c.denumire,
        c.prenume,
        c.tip_entitate,
        c.sediu,
        c.nr_identificare,
        c.cod,
        c.cnp,
        c.tara,
        c.localitate,
        c.judet,
        c.cod_postal,
        c.alte_date,
        c.subscriptor,
        c.nr_ordine
      );
    }

    const insertDebitor = db.prepare(`
      INSERT INTO rnpm_debitori (owner_id, aviz_id, tip_persoana, calitate, denumire, prenume, tip_entitate, sediu, nr_identificare, cod, cnp, tara, localitate, judet, cod_postal, alte_date, subscriptor, nr_ordine)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const d of input.debitori ?? []) {
      insertDebitor.run(
        ownerId,
        avizId,
        d.tip_persoana,
        d.calitate ?? null,
        d.denumire,
        d.prenume,
        d.tip_entitate,
        d.sediu,
        d.nr_identificare,
        d.cod,
        d.cnp,
        d.tara,
        d.localitate,
        d.judet,
        d.cod_postal,
        d.alte_date,
        d.subscriptor,
        d.nr_ordine
      );
    }

    // Dedup descriere via rnpm_bunuri_descrieri — same text across bunuri is stored once.
    const insertDescr = db.prepare("INSERT OR IGNORE INTO rnpm_bunuri_descrieri (text) VALUES (?)");
    const selectDescr = db.prepare("SELECT id FROM rnpm_bunuri_descrieri WHERE text = ?");
    const descrIdCache = new Map<string, number>();
    const getDescrId = (text: string | null): number | null => {
      if (text == null || text === "") return null;
      const cached = descrIdCache.get(text);
      if (cached != null) return cached;
      insertDescr.run(text);
      const row = selectDescr.get(text) as { id: number } | undefined;
      if (!row) return null;
      descrIdCache.set(text, row.id);
      return row.id;
    };

    const insertBun = db.prepare(`
      INSERT INTO rnpm_bunuri (owner_id, aviz_id, tip_bun, categorie, identificare, descriere_id, model, serie_sasiu, serie_motor, nr_inmatriculare, referinte_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const b of input.bunuri ?? []) {
      const refsJson = b.referinte && b.referinte.length > 0 ? JSON.stringify(b.referinte) : null;
      insertBun.run(
        ownerId,
        avizId,
        b.tip_bun,
        b.categorie,
        b.identificare,
        getDescrId(b.descriere),
        b.model,
        b.serie_sasiu,
        b.serie_motor,
        b.nr_inmatriculare,
        refsJson
      );
    }

    const insertIstoric = db.prepare(`
      INSERT INTO rnpm_istoric (owner_id, aviz_id, identificator, uuid, data, tip, inscriere_m_v, inscriere_m_k)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const i of input.istoric ?? []) {
      insertIstoric.run(ownerId, avizId, i.identificator, i.uuid, i.data, i.tip, i.inscriere_m_v, i.inscriere_m_k);
    }

    return avizId;
  });

  return run();
}

export function getAvizById(id: number, ownerId = "local"): AvizFull | null {
  const db = getDb();
  const aviz = db.prepare("SELECT * FROM rnpm_avize WHERE id = ? AND owner_id = ?").get(id, ownerId) as
    | AvizRecord
    | undefined;
  if (!aviz) return null;
  return loadAvizChildren(aviz);
}

export function getAvizByIdentificator(identificator: string, ownerId = "local"): AvizFull | null {
  const db = getDb();
  const aviz = db
    .prepare("SELECT * FROM rnpm_avize WHERE identificator = ? AND owner_id = ?")
    .get(identificator, ownerId) as AvizRecord | undefined;
  if (!aviz) return null;
  return loadAvizChildren(aviz);
}

function loadAvizChildren(aviz: AvizRecord): AvizFull {
  const db = getDb();
  // Defense in depth: aviz row was already filtered by owner_id at the entry
  // point, but child queries must repeat the constraint so that a stale FK
  // (bug-introduced or partial restore) cannot leak rows from a different
  // owner. Pass aviz.owner_id rather than re-deriving it.
  const creditori = db
    .prepare("SELECT * FROM rnpm_creditori WHERE aviz_id = ? AND owner_id = ? ORDER BY id")
    .all(aviz.id, aviz.owner_id) as PartyRecord[];
  const debitori = db
    .prepare("SELECT * FROM rnpm_debitori WHERE aviz_id = ? AND owner_id = ? ORDER BY id")
    .all(aviz.id, aviz.owner_id) as PartyRecord[];
  // JOIN on lookup table so `descriere` arrives populated with the full text,
  // exactly as if it were still a column. API shape is unchanged for callers.
  // rnpm_bunuri_descrieri is an owner-agnostic dedup pool (no owner_id) — only
  // reachable via b.descriere_id which is itself owner-scoped here.
  const bunuriRows = db
    .prepare(`
    SELECT b.id, b.owner_id, b.aviz_id, b.tip_bun, b.categorie, b.identificare,
           bd.text AS descriere,
           b.model, b.serie_sasiu, b.serie_motor, b.nr_inmatriculare, b.referinte_json
    FROM rnpm_bunuri b
    LEFT JOIN rnpm_bunuri_descrieri bd ON bd.id = b.descriere_id
    WHERE b.aviz_id = ? AND b.owner_id = ? ORDER BY b.id
  `)
    .all(aviz.id, aviz.owner_id) as (Omit<BunRecord, "referinte"> & { referinte_json: string | null })[];
  const bunuri: BunRecord[] = bunuriRows.map((r) => {
    const { referinte_json, ...rest } = r;
    let referinte: BunPartyRef[] = [];
    if (referinte_json) {
      try {
        referinte = JSON.parse(referinte_json) as BunPartyRef[];
      } catch {
        referinte = [];
      }
    }
    return { ...rest, referinte };
  });
  const istoric = db
    .prepare("SELECT * FROM rnpm_istoric WHERE aviz_id = ? AND owner_id = ? ORDER BY id")
    .all(aviz.id, aviz.owner_id) as IstoricRecord[];
  return { aviz, creditori, debitori, bunuri, istoric };
}

export interface OffsetPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type AvizSortKey = "id" | "identificator" | "search_type" | "data" | "tip" | "activ";
export type SortDir = "asc" | "desc";

export interface GetAvizeOptions {
  ownerId?: string;
  page?: number;
  pageSize?: number;
  searchType?: string;
  activ?: boolean;
  dataStart?: string;
  dataStop?: string;
  searchText?: string;
  sortKey?: AvizSortKey;
  sortDir?: SortDir;
}

export function getAvize(opts: GetAvizeOptions = {}): OffsetPage<AvizRecord> {
  const db = getDb();
  const ownerId = opts.ownerId ?? "local";
  const pageSize = Math.min(Math.max(opts.pageSize ?? 25, 1), 200);
  const page = Math.max(opts.page ?? 0, 0);

  const where: string[] = ["a.owner_id = ?"];
  const params: (string | number)[] = [ownerId];

  if (opts.searchType) {
    where.push("a.search_type = ?");
    params.push(opts.searchType);
  }
  if (opts.activ != null) {
    where.push("a.activ = ?");
    params.push(opts.activ ? 1 : 0);
  }
  // `data` este stocat ca "dd.mm.yyyy" (format RNPM). Convertim in ISO (yyyy-mm-dd) in SQL
  // pentru comparatie corecta; caller pasa ISO (din <input type="date">).
  if (opts.dataStart) {
    where.push("substr(a.data,7,4)||'-'||substr(a.data,4,2)||'-'||substr(a.data,1,2) >= ?");
    params.push(opts.dataStart);
  }
  if (opts.dataStop) {
    where.push("substr(a.data,7,4)||'-'||substr(a.data,4,2)||'-'||substr(a.data,1,2) <= ?");
    params.push(opts.dataStop);
  }

  if (opts.searchText) {
    // Diacritic-insensitive match: rnpm_norm() folds both sides to lowercase + stripped.
    // Normalize the param once in JS; keep rnpm_norm() only on columns so SQLite
    // doesn't pay the function cost on each LIKE RHS.
    // Escape LIKE meta-characters (% _ \) in user input so they match literally.
    //
    // inscriere_initiala_id / inscriere_modificata_id: pe randurile "aviz de modificare" aceste
    // coloane contin identificator-ul avizului parinte. Includerea lor in cautare face ca
    // filtrarea dupa identificator sa scoata si lantul de modificari legate de parinte (daca sunt in baza).
    where.push(`(
      rnpm_norm(a.identificator) LIKE ? ESCAPE '\\' OR rnpm_norm(a.tip) LIKE ? ESCAPE '\\' OR rnpm_norm(a.utilizator_autorizat) LIKE ? ESCAPE '\\' OR rnpm_norm(a.numar_act) LIKE ? ESCAPE '\\'
      OR rnpm_norm(a.inscriere_initiala_id) LIKE ? ESCAPE '\\' OR rnpm_norm(a.inscriere_modificata_id) LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM rnpm_creditori c WHERE c.aviz_id = a.id AND c.owner_id = a.owner_id AND (rnpm_norm(c.denumire) LIKE ? ESCAPE '\\' OR rnpm_norm(c.cod) LIKE ? ESCAPE '\\' OR rnpm_norm(c.cnp) LIKE ? ESCAPE '\\'))
      OR EXISTS (SELECT 1 FROM rnpm_debitori d WHERE d.aviz_id = a.id AND d.owner_id = a.owner_id AND (rnpm_norm(d.denumire) LIKE ? ESCAPE '\\' OR rnpm_norm(d.cod) LIKE ? ESCAPE '\\' OR rnpm_norm(d.cnp) LIKE ? ESCAPE '\\'))
    )`);
    const like = buildRnpmLikePattern(opts.searchText);
    for (let i = 0; i < 12; i++) params.push(like);
  }

  const whereSql = where.join(" AND ");

  // Total count for the pagination UI.
  const countSql = `SELECT COUNT(*) AS total FROM rnpm_avize a WHERE ${whereSql}`;
  const total = (db.prepare(countSql).get(...params) as { total: number }).total;

  // ORDER BY whitelist — never interpolate user-supplied identifiers into SQL.
  // `data` is stored as "dd.mm.yyyy" so convert to ISO in the expression for correct ordering.
  let orderExpr: string;
  switch (opts.sortKey) {
    case "identificator":
      orderExpr = "a.identificator";
      break;
    case "search_type":
      orderExpr = "a.search_type";
      break;
    case "data":
      orderExpr = "substr(a.data,7,4)||'-'||substr(a.data,4,2)||'-'||substr(a.data,1,2)";
      break;
    case "tip":
      orderExpr = "a.tip";
      break;
    case "activ":
      orderExpr = "a.activ";
      break;
    default:
      orderExpr = "a.id";
      break;
  }
  const dir = opts.sortDir === "asc" ? "ASC" : "DESC";
  // Tie-break by id so pagination is deterministic when the primary sort has ties.
  const orderClause = opts.sortKey && opts.sortKey !== "id" ? `${orderExpr} ${dir}, a.id DESC` : `${orderExpr} ${dir}`;

  const sql = `SELECT a.* FROM rnpm_avize a WHERE ${whereSql} ORDER BY ${orderClause} LIMIT ? OFFSET ?`;
  const rows = db.prepare(sql).all(...params, pageSize, page * pageSize) as AvizRecord[];

  return { items: rows, total, page, pageSize };
}

// GC orfani: rnpm_bunuri_descrieri e un lookup dedup-uit (nu legat direct de aviz),
// deci CASCADE nu il atinge cand stergem avize. Aici stergem randurile fara referinte
// din rnpm_bunuri. Index pe rnpm_bunuri(descriere_id) face NOT EXISTS eficient chiar si pe zeci de mii de randuri.
function cleanupOrphanDescrieri(db: ReturnType<typeof getDb>): number {
  const res = db
    .prepare(`
    DELETE FROM rnpm_bunuri_descrieri
    WHERE NOT EXISTS (
      SELECT 1 FROM rnpm_bunuri WHERE rnpm_bunuri.descriere_id = rnpm_bunuri_descrieri.id
    )
  `)
    .run();
  return res.changes;
}

export function deleteAviz(id: number, ownerId = "local"): boolean {
  const db = getDb();
  const deleted = db.transaction(() => {
    const res = db.prepare("DELETE FROM rnpm_avize WHERE id = ? AND owner_id = ?").run(id, ownerId);
    if (res.changes > 0) cleanupOrphanDescrieri(db);
    return res.changes > 0;
  })();
  // Checkpoint WAL dupa tranzactie — altfel fisierul -wal creste continuu si modalul "date + jurnal" urca.
  if (deleted) checkpointWal();
  return deleted;
}

export function deleteAllAvize(ownerId = "local"): number {
  const db = getDb();
  // Sterge avizele (CASCADE curata creditori/debitori/bunuri/istoric) si metadata din rnpm_searches.
  // search_id din rnpm_avize are ON DELETE SET NULL, deci searches nu cad in cascada — le stergem explicit.
  const changes = db.transaction(() => {
    const res = db.prepare("DELETE FROM rnpm_avize WHERE owner_id = ?").run(ownerId);
    db.prepare("DELETE FROM rnpm_searches WHERE owner_id = ?").run(ownerId);
    if (res.changes > 0) cleanupOrphanDescrieri(db);
    return res.changes;
  })();
  if (changes > 0) checkpointWal();
  return changes;
}

export function deleteAvizeByIds(ids: number[], ownerId = "local"): number {
  if (ids.length === 0) return 0;
  const db = getDb();
  const placeholders = ids.map(() => "?").join(",");
  // CASCADE pe creditori/debitori/bunuri/istoric; rnpm_searches nu se sterge aici
  // (pot ramane cu search_id = NULL pe randuri pastrate din aceeasi cautare).
  const changes = db.transaction(() => {
    const res = db
      .prepare(`DELETE FROM rnpm_avize WHERE owner_id = ? AND id IN (${placeholders})`)
      .run(ownerId, ...ids);
    if (res.changes > 0) cleanupOrphanDescrieri(db);
    return res.changes;
  })();
  if (changes > 0) checkpointWal();
  return changes;
}

export interface AvizStats {
  total: number;
  activ: number;
  inactiv: number;
  byType: Record<string, number>;
}

export function getAvizStats(ownerId = "local"): AvizStats {
  const db = getDb();
  const totals = db
    .prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN activ = 1 THEN 1 ELSE 0 END), 0) AS activ,
      COALESCE(SUM(CASE WHEN activ = 0 THEN 1 ELSE 0 END), 0) AS inactiv
    FROM rnpm_avize WHERE owner_id = ?
  `)
    .get(ownerId) as { total: number; activ: number; inactiv: number };

  const rows = db
    .prepare("SELECT search_type, COUNT(*) AS n FROM rnpm_avize WHERE owner_id = ? GROUP BY search_type")
    .all(ownerId) as { search_type: string; n: number }[];

  const byType: Record<string, number> = {};
  for (const r of rows) byType[r.search_type] = r.n;

  return { total: totals.total, activ: totals.activ, inactiv: totals.inactiv, byType };
}

export function getAvizeByIds(ids: number[], ownerId = "local"): AvizFull[] {
  if (ids.length === 0) return [];
  const db = getDb();
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT * FROM rnpm_avize WHERE owner_id = ? AND id IN (${placeholders}) ORDER BY id DESC`)
    .all(ownerId, ...ids) as AvizRecord[];
  return rows.map(loadAvizChildren);
}

// ============================================================================
// filterRnpmSearchResults - v2.24.0
// Filtru text incremental peste rezultatele unei cautari RNPM. Returneaza
// doar ID-uri matched + counters; UI filtreaza local pe Set<id>.
// NU se foloseste in /api/rnpm/saved (acela merge prin getAvize). NU atinge
// getAvize() - duplicare minima acceptata pentru zero-regresie.
// Acopera 24 coloane: 9 din rnpm_avize + 3 creditori + 3 debitori + 9 bunuri
// (tip_bun + categorie + identificare + model + serie_sasiu + serie_motor +
//  nr_inmatriculare + referinte_json + JOIN cu rnpm_bunuri_descrieri.text).
// NOTA: rnpm_bunuri nu are coloana `descriere_proprie`; textul descrierii vine
// exclusiv via descriere_id -> rnpm_bunuri_descrieri.text.
// ============================================================================

function buildResultsFilterClause(q: string): { whereSql: string; params: string[] } {
  const like = buildRnpmLikePattern(q);
  const whereSql = `(
    rnpm_norm(a.identificator) LIKE ? ESCAPE '\\'
    OR rnpm_norm(a.tip) LIKE ? ESCAPE '\\'
    OR rnpm_norm(a.utilizator_autorizat) LIKE ? ESCAPE '\\'
    OR rnpm_norm(a.numar_act) LIKE ? ESCAPE '\\'
    OR rnpm_norm(a.tip_act) LIKE ? ESCAPE '\\'
    OR rnpm_norm(a.alte_mentiuni) LIKE ? ESCAPE '\\'
    OR rnpm_norm(a.detalii_comune) LIKE ? ESCAPE '\\'
    OR rnpm_norm(a.inscriere_initiala_id) LIKE ? ESCAPE '\\'
    OR rnpm_norm(a.inscriere_modificata_id) LIKE ? ESCAPE '\\'
    OR EXISTS (SELECT 1 FROM rnpm_creditori c
      WHERE c.aviz_id = a.id AND c.owner_id = a.owner_id
      AND (rnpm_norm(c.denumire) LIKE ? ESCAPE '\\'
        OR rnpm_norm(c.cod) LIKE ? ESCAPE '\\'
        OR rnpm_norm(c.cnp) LIKE ? ESCAPE '\\'))
    OR EXISTS (SELECT 1 FROM rnpm_debitori d
      WHERE d.aviz_id = a.id AND d.owner_id = a.owner_id
      AND (rnpm_norm(d.denumire) LIKE ? ESCAPE '\\'
        OR rnpm_norm(d.cod) LIKE ? ESCAPE '\\'
        OR rnpm_norm(d.cnp) LIKE ? ESCAPE '\\'))
    OR EXISTS (SELECT 1 FROM rnpm_bunuri b
      LEFT JOIN rnpm_bunuri_descrieri bd ON bd.id = b.descriere_id
      WHERE b.aviz_id = a.id AND b.owner_id = a.owner_id
      AND (rnpm_norm(b.tip_bun) LIKE ? ESCAPE '\\'
        OR rnpm_norm(b.categorie) LIKE ? ESCAPE '\\'
        OR rnpm_norm(b.identificare) LIKE ? ESCAPE '\\'
        OR rnpm_norm(b.model) LIKE ? ESCAPE '\\'
        OR rnpm_norm(b.serie_sasiu) LIKE ? ESCAPE '\\'
        OR rnpm_norm(b.serie_motor) LIKE ? ESCAPE '\\'
        OR rnpm_norm(b.nr_inmatriculare) LIKE ? ESCAPE '\\'
        OR rnpm_norm(b.referinte_json) LIKE ? ESCAPE '\\'
        OR rnpm_norm(bd.text) LIKE ? ESCAPE '\\'))
  )`;
  const params: string[] = Array(24).fill(like);
  return { whereSql, params };
}

export interface FilterRnpmResultsOptions {
  ownerId: string;
  searchId: number;
  q: string;
  limit?: number;
  signal?: AbortSignal;
}

export interface FilterRnpmResultsOutcome {
  matchedAvizIds: number[];
  matchedCount: number;
  totalInSearch: number;
  missingDetails: number;
  truncated: boolean;
}

export class RnpmSearchNotFoundError extends Error {
  readonly code = "SEARCH_NOT_FOUND" as const;
  constructor() {
    super("Search inexistent");
    this.name = "RnpmSearchNotFoundError";
  }
}

export function filterRnpmSearchResults(opts: FilterRnpmResultsOptions): FilterRnpmResultsOutcome {
  const HARD_LIMIT = 1500;
  const db = getDb();
  const { ownerId, searchId, q, signal } = opts;
  const limit = Math.min(opts.limit ?? HARD_LIMIT, HARD_LIMIT);

  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  // Ownership precheck (anti-enumeration). Acelasi 404 pentru "nu exista"
  // si "apartine altui owner" - vezi spec 4.4.
  const owns = db.prepare("SELECT 1 AS ok FROM rnpm_searches WHERE id = ? AND owner_id = ?").get(searchId, ownerId) as
    | { ok: number }
    | undefined;
  if (!owns) throw new RnpmSearchNotFoundError();

  const totalRow = db
    .prepare("SELECT COUNT(*) AS total FROM rnpm_avize WHERE owner_id = ? AND search_id = ?")
    .get(ownerId, searchId) as { total: number };
  const totalInSearch = totalRow.total;

  const missRow = db
    .prepare("SELECT COUNT(*) AS m FROM rnpm_avize WHERE owner_id = ? AND search_id = ? AND detail_fetched = 0")
    .get(ownerId, searchId) as { m: number };
  const missingDetails = missRow.m;

  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const { whereSql, params } = buildResultsFilterClause(q);

  const countSql = `SELECT COUNT(*) AS c FROM rnpm_avize a
    WHERE a.owner_id = ? AND a.search_id = ? AND ${whereSql}`;
  const countRow = db.prepare(countSql).get(ownerId, searchId, ...params) as { c: number };
  const matchedCount = countRow.c;

  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const sql = `SELECT a.id FROM rnpm_avize a
    WHERE a.owner_id = ? AND a.search_id = ? AND ${whereSql}
    ORDER BY a.id ASC LIMIT ?`;
  const rows = db.prepare(sql).all(ownerId, searchId, ...params, limit) as { id: number }[];
  const matchedAvizIds = rows.map((r) => r.id);

  return {
    matchedAvizIds,
    matchedCount,
    totalInSearch,
    missingDetails,
    truncated: matchedCount > limit,
  };
}

import { getDb } from "./schema.ts";
import type { CursorPage } from "./searchRepository.ts";
import { stripDiacritics } from "../util/textNormalize.ts";

export interface AvizRecord {
  id: number;
  owner_id: string;
  uuid: string;
  identificator: string;
  search_type: string;
  tip: string;
  data: string;
  utilizator_autorizat: string | null;
  activ: number;
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
  activ?: boolean;
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

export function saveAvizFull(input: SaveAvizInput): number {
  const db = getDb();
  const ownerId = input.ownerId ?? "local";

  const run = db.transaction((): number => {
    const existing = db.prepare(
      `SELECT id FROM rnpm_avize WHERE owner_id = ? AND identificator = ?`
    ).get(ownerId, input.identificator) as { id: number } | undefined;

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
        input.uuid, input.searchType, input.tip, input.data, input.utilizatorAutorizat ?? null,
        input.activ === false ? 0 : 1, input.needsActualizare ? 1 : 0,
        input.destinatie ?? null, input.tipAct ?? null, input.numarAct ?? null,
        input.dataInreg ?? null, input.dataExpirare ?? null, input.alteMentiuni ?? null,
        input.detaliiComune ?? null,
        input.inscriereInitialaId ?? null, input.inscriereInitialaUuid ?? null,
        input.inscriereModificataId ?? null, input.inscriereModificataUuid ?? null,
        input.detailFetched ? 1 : 0,
        input.searchId ?? null, avizId
      );
      db.prepare(`DELETE FROM rnpm_creditori WHERE aviz_id = ?`).run(avizId);
      db.prepare(`DELETE FROM rnpm_debitori WHERE aviz_id = ?`).run(avizId);
      db.prepare(`DELETE FROM rnpm_bunuri WHERE aviz_id = ?`).run(avizId);
      db.prepare(`DELETE FROM rnpm_istoric WHERE aviz_id = ?`).run(avizId);
    } else {
      const res = db.prepare(`
        INSERT INTO rnpm_avize (
          owner_id, uuid, identificator, search_type, tip, data, utilizator_autorizat,
          activ, needs_actualizare, destinatie, tip_act, numar_act, data_inreg, data_expirare,
          alte_mentiuni, detalii_comune, inscriere_initiala_id, inscriere_initiala_uuid,
          inscriere_modificata_id, inscriere_modificata_uuid,
          detail_fetched, search_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        ownerId, input.uuid, input.identificator, input.searchType, input.tip, input.data,
        input.utilizatorAutorizat ?? null,
        input.activ === false ? 0 : 1, input.needsActualizare ? 1 : 0,
        input.destinatie ?? null, input.tipAct ?? null, input.numarAct ?? null,
        input.dataInreg ?? null, input.dataExpirare ?? null, input.alteMentiuni ?? null,
        input.detaliiComune ?? null,
        input.inscriereInitialaId ?? null, input.inscriereInitialaUuid ?? null,
        input.inscriereModificataId ?? null, input.inscriereModificataUuid ?? null,
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
      insertCreditor.run(ownerId, avizId, c.tip_persoana, c.denumire, c.prenume, c.tip_entitate, c.sediu, c.nr_identificare, c.cod, c.cnp, c.tara, c.localitate, c.judet, c.cod_postal, c.alte_date, c.subscriptor, c.nr_ordine);
    }

    const insertDebitor = db.prepare(`
      INSERT INTO rnpm_debitori (owner_id, aviz_id, tip_persoana, calitate, denumire, prenume, tip_entitate, sediu, nr_identificare, cod, cnp, tara, localitate, judet, cod_postal, alte_date, subscriptor, nr_ordine)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const d of input.debitori ?? []) {
      insertDebitor.run(ownerId, avizId, d.tip_persoana, d.calitate ?? null, d.denumire, d.prenume, d.tip_entitate, d.sediu, d.nr_identificare, d.cod, d.cnp, d.tara, d.localitate, d.judet, d.cod_postal, d.alte_date, d.subscriptor, d.nr_ordine);
    }

    const insertBun = db.prepare(`
      INSERT INTO rnpm_bunuri (owner_id, aviz_id, tip_bun, categorie, identificare, descriere, model, serie_sasiu, serie_motor, nr_inmatriculare, referinte_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const b of input.bunuri ?? []) {
      const refsJson = b.referinte && b.referinte.length > 0 ? JSON.stringify(b.referinte) : null;
      insertBun.run(ownerId, avizId, b.tip_bun, b.categorie, b.identificare, b.descriere, b.model, b.serie_sasiu, b.serie_motor, b.nr_inmatriculare, refsJson);
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
  const aviz = db.prepare(`SELECT * FROM rnpm_avize WHERE id = ? AND owner_id = ?`).get(id, ownerId) as AvizRecord | undefined;
  if (!aviz) return null;
  return loadAvizChildren(aviz);
}

export function getAvizByIdentificator(identificator: string, ownerId = "local"): AvizFull | null {
  const db = getDb();
  const aviz = db.prepare(`SELECT * FROM rnpm_avize WHERE identificator = ? AND owner_id = ?`).get(identificator, ownerId) as AvizRecord | undefined;
  if (!aviz) return null;
  return loadAvizChildren(aviz);
}

function loadAvizChildren(aviz: AvizRecord): AvizFull {
  const db = getDb();
  const creditori = db.prepare(`SELECT * FROM rnpm_creditori WHERE aviz_id = ? ORDER BY id`).all(aviz.id) as PartyRecord[];
  const debitori = db.prepare(`SELECT * FROM rnpm_debitori WHERE aviz_id = ? ORDER BY id`).all(aviz.id) as PartyRecord[];
  const bunuriRows = db.prepare(`SELECT * FROM rnpm_bunuri WHERE aviz_id = ? ORDER BY id`).all(aviz.id) as (Omit<BunRecord, "referinte"> & { referinte_json: string | null })[];
  const bunuri: BunRecord[] = bunuriRows.map((r) => {
    const { referinte_json, ...rest } = r;
    let referinte: BunPartyRef[] = [];
    if (referinte_json) {
      try { referinte = JSON.parse(referinte_json) as BunPartyRef[]; } catch { referinte = []; }
    }
    return { ...rest, referinte };
  });
  const istoric = db.prepare(`SELECT * FROM rnpm_istoric WHERE aviz_id = ? ORDER BY id`).all(aviz.id) as IstoricRecord[];
  return { aviz, creditori, debitori, bunuri, istoric };
}

export interface GetAvizeOptions {
  ownerId?: string;
  limit?: number;
  cursor?: number | null;
  searchType?: string;
  activ?: boolean;
  dataStart?: string;
  dataStop?: string;
  searchText?: string;
}

export function getAvize(opts: GetAvizeOptions = {}): CursorPage<AvizRecord> {
  const db = getDb();
  const ownerId = opts.ownerId ?? "local";
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);

  const where: string[] = ["a.owner_id = ?"];
  const params: (string | number)[] = [ownerId];

  if (opts.cursor != null) { where.push("a.id < ?"); params.push(opts.cursor); }
  if (opts.searchType) { where.push("a.search_type = ?"); params.push(opts.searchType); }
  if (opts.activ != null) { where.push("a.activ = ?"); params.push(opts.activ ? 1 : 0); }
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
    where.push(`(
      rnpm_norm(a.identificator) LIKE ? ESCAPE '\\' OR rnpm_norm(a.tip) LIKE ? ESCAPE '\\' OR rnpm_norm(a.utilizator_autorizat) LIKE ? ESCAPE '\\' OR rnpm_norm(a.numar_act) LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM rnpm_creditori c WHERE c.aviz_id = a.id AND (rnpm_norm(c.denumire) LIKE ? ESCAPE '\\' OR rnpm_norm(c.cod) LIKE ? ESCAPE '\\' OR rnpm_norm(c.cnp) LIKE ? ESCAPE '\\'))
      OR EXISTS (SELECT 1 FROM rnpm_debitori d WHERE d.aviz_id = a.id AND (rnpm_norm(d.denumire) LIKE ? ESCAPE '\\' OR rnpm_norm(d.cod) LIKE ? ESCAPE '\\' OR rnpm_norm(d.cnp) LIKE ? ESCAPE '\\'))
    )`);
    const escaped = stripDiacritics(opts.searchText).toLowerCase().replace(/[\\%_]/g, "\\$&");
    const like = `%${escaped}%`;
    for (let i = 0; i < 10; i++) params.push(like);
  }

  const sql = `SELECT a.* FROM rnpm_avize a WHERE ${where.join(" AND ")} ORDER BY a.id DESC LIMIT ?`;
  params.push(limit + 1);
  const rows = db.prepare(sql).all(...params) as AvizRecord[];

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

export function deleteAviz(id: number, ownerId = "local"): boolean {
  const db = getDb();
  const res = db.prepare(`DELETE FROM rnpm_avize WHERE id = ? AND owner_id = ?`).run(id, ownerId);
  return res.changes > 0;
}

export function deleteAllAvize(ownerId = "local"): number {
  const db = getDb();
  // Sterge avizele (CASCADE curata creditori/debitori/bunuri/istoric) si metadata din rnpm_searches.
  // search_id din rnpm_avize are ON DELETE SET NULL, deci searches nu cad in cascada — le stergem explicit.
  return db.transaction(() => {
    const res = db.prepare(`DELETE FROM rnpm_avize WHERE owner_id = ?`).run(ownerId);
    db.prepare(`DELETE FROM rnpm_searches WHERE owner_id = ?`).run(ownerId);
    return res.changes;
  })();
}

export function deleteAvizeByIds(ids: number[], ownerId = "local"): number {
  if (ids.length === 0) return 0;
  const db = getDb();
  const placeholders = ids.map(() => "?").join(",");
  // CASCADE pe creditori/debitori/bunuri/istoric; rnpm_searches nu se sterge aici
  // (pot ramane cu search_id = NULL pe randuri pastrate din aceeasi cautare).
  const res = db.prepare(
    `DELETE FROM rnpm_avize WHERE owner_id = ? AND id IN (${placeholders})`
  ).run(ownerId, ...ids);
  return res.changes;
}

export interface AvizStats {
  total: number;
  activ: number;
  inactiv: number;
  byType: Record<string, number>;
}

export function getAvizStats(ownerId = "local"): AvizStats {
  const db = getDb();
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN activ = 1 THEN 1 ELSE 0 END), 0) AS activ,
      COALESCE(SUM(CASE WHEN activ = 0 THEN 1 ELSE 0 END), 0) AS inactiv
    FROM rnpm_avize WHERE owner_id = ?
  `).get(ownerId) as { total: number; activ: number; inactiv: number };

  const rows = db.prepare(
    `SELECT search_type, COUNT(*) AS n FROM rnpm_avize WHERE owner_id = ? GROUP BY search_type`
  ).all(ownerId) as { search_type: string; n: number }[];

  const byType: Record<string, number> = {};
  for (const r of rows) byType[r.search_type] = r.n;

  return { total: totals.total, activ: totals.activ, inactiv: totals.inactiv, byType };
}

export function getAvizeByIds(ids: number[], ownerId = "local"): AvizFull[] {
  if (ids.length === 0) return [];
  const db = getDb();
  const placeholders = ids.map(() => "?").join(",");
  const rows = db.prepare(
    `SELECT * FROM rnpm_avize WHERE owner_id = ? AND id IN (${placeholders}) ORDER BY id DESC`
  ).all(ownerId, ...ids) as AvizRecord[];
  return rows.map(loadAvizChildren);
}

// Repository layer for name_lists + name_list_items (PR-5).
//
// Single writer per upload: createList ruleaza intr-o tranzactie unica care
// insera rindul name_lists si toate name_list_items aferente, mentinand
// total_rows / valid_rows in sincron. Owner_id este aplicat pe orice read si
// write — same posture as monitoringJobsRepository / auditRepository.
//
// Idempotenta uploadului: UNIQUE(owner_id, source_sha256) face dintr-un
// re-upload al aceluiasi fisier o operatie no-op (returnam lista existenta).
// Util mai ales dupa restore din backup unde clientul retrimite acelasi fisier.
//
// Asocierea `name_list_items.monitoring_job_id` este populata DUPA ce
// monitoring_jobs e creat (linkItemToJob). Tinta nu poate fi populata in
// tranzactia createList pentru ca la momentul ala joburile inca nu exista
// (commit-ul de joburi face parte din /commit, dupa preview).

import { getDb } from "./schema.ts";

// Validation status pentru un rind individual din lista. Decizii:
//   - 'ok'       — toate campurile prezente, name_kind explicit, dedup OK
//   - 'warn'     — rindul e folosibil dar a aparut un default (ex: tip lipsea
//                  si parser-ul a setat 'fizic'). Devine job pe commit.
//   - 'rejected' — rindul nu poate deveni job (nume gol, format invalid,
//                  duplicat in fisier). NU devine job pe commit.
export type NameListItemValidation = "ok" | "warn" | "rejected";

export type NameListItemKind = "fizic" | "juridic";

export interface NameListRow {
  id: number;
  owner_id: string;
  title: string;
  source_filename: string | null;
  source_sha256: string;
  total_rows: number;
  valid_rows: number;
  created_at: string;
  archived_at: string | null;
}

export interface NameListItemRow {
  id: number;
  owner_id: string;
  list_id: number;
  name_kind: NameListItemKind;
  name_raw: string;
  name_normalized: string;
  cnp: string | null;
  cui: string | null;
  validation: NameListItemValidation;
  validation_msg: string | null;
  monitoring_job_id: number | null;
  created_at: string;
}

export interface CreateListItemInput {
  nameKind: NameListItemKind;
  nameRaw: string;
  nameNormalized: string;
  cnp?: string | null;
  cui?: string | null;
  validation: NameListItemValidation;
  validationMsg?: string | null;
}

export interface CreateListInput {
  ownerId: string;
  title: string;
  sourceFilename: string | null;
  sourceSha256: string;
  items: CreateListItemInput[];
}

export interface CreateListResult {
  list: NameListRow;
  /** true cand lista existase deja (UNIQUE(owner_id, source_sha256) replay). */
  duplicate: boolean;
}

export function createList(input: CreateListInput): CreateListResult {
  const db = getDb();

  // Replay path INAINTE de tranzactie — daca acelasi fisier a mai fost incarcat,
  // returnam lista veche fara sa atingem items. Decizia adversa ar fi sa
  // re-uploadul sa rescrie items, dar atunci join-ul cu monitoring_jobs prin
  // monitoring_job_id ar fi invalidat (joburile vechi pierd lineage).
  const existing = db
    .prepare(
      `SELECT * FROM name_lists
       WHERE owner_id = ? AND source_sha256 = ?`,
    )
    .get(input.ownerId, input.sourceSha256) as NameListRow | undefined;
  if (existing) {
    return { list: existing, duplicate: true };
  }

  const tx = db.transaction((): NameListRow => {
    // total_rows = toate rindurile parsate (inclusiv 'rejected'); valid_rows
    // = rindurile care VOR deveni joburi pe commit (ok + warn). UI-ul afiseaza
    // ambele ca sa fie clar cati userii au fost respinsi.
    const totalRows = input.items.length;
    const validRows = input.items.filter(
      (it) => it.validation !== "rejected",
    ).length;

    const listInfo = db
      .prepare(
        `INSERT INTO name_lists
           (owner_id, title, source_filename, source_sha256,
            total_rows, valid_rows)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.ownerId,
        input.title,
        input.sourceFilename,
        input.sourceSha256,
        totalRows,
        validRows,
      );
    const listId = listInfo.lastInsertRowid as number;

    if (input.items.length > 0) {
      const insertItem = db.prepare(
        `INSERT INTO name_list_items
           (owner_id, list_id, name_kind, name_raw, name_normalized,
            cnp, cui, validation, validation_msg)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const item of input.items) {
        insertItem.run(
          input.ownerId,
          listId,
          item.nameKind,
          item.nameRaw,
          item.nameNormalized,
          item.cnp ?? null,
          item.cui ?? null,
          item.validation,
          item.validationMsg ?? null,
        );
      }
    }

    return db
      .prepare(`SELECT * FROM name_lists WHERE id = ?`)
      .get(listId) as NameListRow;
  });

  // BEGIN IMMEDIATE: scriem un nr. de rinduri proportional cu marimea
  // fisierului (pina la cap-ul aplicat la parser); IMMEDIATE elimina
  // race-ul cu un al doilea import paralel pe acelasi sha256.
  const list = tx.immediate();
  return { list, duplicate: false };
}

export function getListById(
  ownerId: string,
  id: number,
): NameListRow | null {
  const row = getDb()
    .prepare(`SELECT * FROM name_lists WHERE id = ? AND owner_id = ?`)
    .get(id, ownerId) as NameListRow | undefined;
  return row ?? null;
}

export interface ListListsOptions {
  ownerId: string;
  page: number;
  pageSize: number;
  /** true → include archived; false sau undefined → doar active */
  includeArchived?: boolean;
}

export interface ListListsResult {
  rows: NameListRow[];
  total: number;
  page: number;
  pageSize: number;
}

export function listLists(opts: ListListsOptions): ListListsResult {
  const db = getDb();
  const where: string[] = ["owner_id = ?"];
  const params: (string | number)[] = [opts.ownerId];
  if (!opts.includeArchived) {
    where.push("archived_at IS NULL");
  }
  const whereSql = `WHERE ${where.join(" AND ")}`;

  const total = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM name_lists ${whereSql}`)
      .get(...params) as { n: number }
  ).n;

  const offset = (opts.page - 1) * opts.pageSize;
  const rows = db
    .prepare(
      `SELECT * FROM name_lists
       ${whereSql}
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, opts.pageSize, offset) as NameListRow[];

  return { rows, total, page: opts.page, pageSize: opts.pageSize };
}

export interface ListItemsOptions {
  ownerId: string;
  listId: number;
  page: number;
  pageSize: number;
  validation?: NameListItemValidation;
}

export interface ListItemsResult {
  rows: NameListItemRow[];
  total: number;
  page: number;
  pageSize: number;
}

export function listItems(opts: ListItemsOptions): ListItemsResult {
  const db = getDb();
  const where: string[] = ["owner_id = ?", "list_id = ?"];
  const params: (string | number)[] = [opts.ownerId, opts.listId];
  if (opts.validation) {
    where.push("validation = ?");
    params.push(opts.validation);
  }
  const whereSql = `WHERE ${where.join(" AND ")}`;

  const total = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM name_list_items ${whereSql}`)
      .get(...params) as { n: number }
  ).n;

  const offset = (opts.page - 1) * opts.pageSize;
  const rows = db
    .prepare(
      `SELECT * FROM name_list_items
       ${whereSql}
       ORDER BY id ASC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, opts.pageSize, offset) as NameListItemRow[];

  return { rows, total, page: opts.page, pageSize: opts.pageSize };
}

// Returneaza items eligibile pentru commit (ok + warn). Folosit de routa
// /commit dupa ce userul confirma preview-ul.
export function getCommittableItems(
  ownerId: string,
  listId: number,
): NameListItemRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM name_list_items
       WHERE owner_id = ? AND list_id = ?
         AND validation IN ('ok','warn')
         AND monitoring_job_id IS NULL
       ORDER BY id ASC`,
    )
    .all(ownerId, listId) as NameListItemRow[];
}

// Ataseaza un item de un job creat. Apelat in tranzactia /commit dupa fiecare
// createJob ca sa mentinem lineage-ul invers (UI: "items pentru job X" / "job
// pentru item X"). Idempotent: daca item-ul are deja monitoring_job_id setat,
// nu suprascriem (un retry pe /commit nu ar trebui sa schimbe legaturile).
export function linkItemToJob(
  ownerId: string,
  itemId: number,
  jobId: number,
): boolean {
  const info = getDb()
    .prepare(
      `UPDATE name_list_items
         SET monitoring_job_id = ?
       WHERE id = ? AND owner_id = ? AND monitoring_job_id IS NULL`,
    )
    .run(jobId, itemId, ownerId);
  return info.changes > 0;
}

// Soft-delete: muta lista in archived. RESTRICT pe FK forteaza ca toate
// joburile sa fie sterse INAINTE — daca exista joburi nelistate, raisuim
// o eroare cu numarul lor ca operatorul sa stie ce mai are de archivat.
//
// Returneaza:
//   - { archived: true }                       cand soft-delete-ul a reusit
//   - { archived: false, blockingJobs: N }     cand exista joburi care
//                                              previn archivarea
export interface ArchiveListResult {
  archived: boolean;
  blockingJobs: number;
}

export function archiveList(
  ownerId: string,
  listId: number,
): ArchiveListResult {
  const db = getDb();

  // Numara joburile care inca exista cu name_list_id = ?. Daca exista, refuzam
  // archivarea (RESTRICT s-ar declansa abia la DELETE; archive este soft-delete
  // dar pastram acelasi guard ca sa fie vizibil userului).
  const blocking = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM monitoring_jobs
         WHERE owner_id = ? AND name_list_id = ?`,
      )
      .get(ownerId, listId) as { n: number }
  ).n;

  if (blocking > 0) {
    return { archived: false, blockingJobs: blocking };
  }

  const info = db
    .prepare(
      `UPDATE name_lists
         SET archived_at = datetime('now')
       WHERE id = ? AND owner_id = ? AND archived_at IS NULL`,
    )
    .run(listId, ownerId);

  return { archived: info.changes > 0, blockingJobs: 0 };
}

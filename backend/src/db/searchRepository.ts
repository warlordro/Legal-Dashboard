import { getDb } from "./schema.ts";

export interface SearchRecord {
  id: number;
  owner_id: string;
  search_type: string;
  params_json: string;
  total_results: number;
  criteriu: string | null;
  created_at: string;
}

export interface SaveSearchInput {
  ownerId?: string;
  searchType: string;
  paramsJson: string;
  totalResults: number;
  criteriu?: string | null;
}

export function saveSearch(input: SaveSearchInput): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO rnpm_searches (owner_id, search_type, params_json, total_results, criteriu)
    VALUES (?, ?, ?, ?, ?)
  `);
  const res = stmt.run(
    input.ownerId ?? "local",
    input.searchType,
    input.paramsJson,
    input.totalResults,
    input.criteriu ?? null
  );
  return Number(res.lastInsertRowid);
}

export interface GetSearchesOptions {
  ownerId?: string;
  limit?: number;
  cursor?: number | null;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: number | null;
}

export function getSearches(opts: GetSearchesOptions = {}): CursorPage<SearchRecord> {
  const db = getDb();
  const ownerId = opts.ownerId ?? "local";
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const cursor = opts.cursor ?? null;

  const rows =
    cursor == null
      ? (db
          .prepare(`SELECT * FROM rnpm_searches WHERE owner_id = ? ORDER BY id DESC LIMIT ?`)
          .all(ownerId, limit + 1) as SearchRecord[])
      : (db
          .prepare(`SELECT * FROM rnpm_searches WHERE owner_id = ? AND id < ? ORDER BY id DESC LIMIT ?`)
          .all(ownerId, cursor, limit + 1) as SearchRecord[]);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

export function updateSearchTotal(id: number, totalResults: number, ownerId = "local"): boolean {
  const db = getDb();
  const res = db
    .prepare(`UPDATE rnpm_searches SET total_results = ? WHERE id = ? AND owner_id = ?`)
    .run(totalResults, id, ownerId);
  return res.changes > 0;
}

export function deleteSearch(id: number, ownerId = "local"): boolean {
  const db = getDb();
  const res = db.prepare(`DELETE FROM rnpm_searches WHERE id = ? AND owner_id = ?`).run(id, ownerId);
  return res.changes > 0;
}

// Tenant guard pentru continuari de cautare RNPM. Clientul poate trimite un
// `existingSearchId` arbitrar; fara aceasta verificare, avizele descoperite
// in continuare s-ar lega de istoricul altui owner. Vezi audit 2026-04-29 #11.
export function searchBelongsToOwner(id: number, ownerId: string): boolean {
  const db = getDb();
  const row = db.prepare(`SELECT 1 FROM rnpm_searches WHERE id = ? AND owner_id = ? LIMIT 1`).get(id, ownerId);
  return row !== undefined;
}

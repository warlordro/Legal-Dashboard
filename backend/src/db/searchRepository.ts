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

// F2 hardening (v2.28.4): ownerId obligatoriu pentru toate web-facing APIs.
// Singura sursa de fallback `"local"` este `getOwnerId()` din
// `backend/src/middleware/owner.ts` — desktop ramane neschimbat, web mode
// arunca daca authProvider-ul nu seteaza ownerId in context.
export interface SaveSearchInput {
  ownerId: string;
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
  const res = stmt.run(input.ownerId, input.searchType, input.paramsJson, input.totalResults, input.criteriu ?? null);
  return Number(res.lastInsertRowid);
}

export interface GetSearchesOptions {
  ownerId: string;
  limit?: number;
  cursor?: number | null;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: number | null;
}

export function getSearches(opts: GetSearchesOptions): CursorPage<SearchRecord> {
  const db = getDb();
  const ownerId = opts.ownerId;
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const cursor = opts.cursor ?? null;

  const rows =
    cursor == null
      ? (db
          .prepare("SELECT * FROM rnpm_searches WHERE owner_id = ? ORDER BY id DESC LIMIT ?")
          .all(ownerId, limit + 1) as SearchRecord[])
      : (db
          .prepare("SELECT * FROM rnpm_searches WHERE owner_id = ? AND id < ? ORDER BY id DESC LIMIT ?")
          .all(ownerId, cursor, limit + 1) as SearchRecord[]);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

export function updateSearchTotal(id: number, totalResults: number, ownerId = "local"): boolean {
  const db = getDb();
  const res = db
    .prepare("UPDATE rnpm_searches SET total_results = ? WHERE id = ? AND owner_id = ?")
    .run(totalResults, id, ownerId);
  return res.changes > 0;
}

export function deleteSearch(id: number, ownerId = "local"): boolean {
  const db = getDb();
  const res = db.prepare("DELETE FROM rnpm_searches WHERE id = ? AND owner_id = ?").run(id, ownerId);
  return res.changes > 0;
}

// Tenant guard pentru continuari de cautare RNPM. Clientul poate trimite un
// `existingSearchId` arbitrar; fara aceasta verificare, avizele descoperite
// in continuare s-ar lega de istoricul altui owner. Vezi audit 2026-04-29 #11.
export function searchBelongsToOwner(id: number, ownerId: string): boolean {
  return getSearchOwnership(id, ownerId) === "owned";
}

// 3-state ownership pentru a putea distinge "row sters din baza" (missing) de
// "row exista dar e al altui tenant" (foreign). Missing nu e atac — apare cand
// userul sterge baza ("Sterge baza") iar UI-ul cache-uieste searchId vechi.
// Foreign trebuie sa ramana 403 ca sa pastram garda din audit 2026-04-29 #11.
export type SearchOwnership = "owned" | "foreign" | "missing";

export function getSearchOwnership(id: number, ownerId: string): SearchOwnership {
  const db = getDb();
  const row = db.prepare("SELECT owner_id FROM rnpm_searches WHERE id = ? LIMIT 1").get(id) as
    | { owner_id: string }
    | undefined;
  if (!row) return "missing";
  return row.owner_id === ownerId ? "owned" : "foreign";
}

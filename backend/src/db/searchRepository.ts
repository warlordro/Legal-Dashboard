import { getRnpmDb } from "./rnpmDb.ts";
import { assertOwnerIdForMutation } from "../util/ownerGuard.ts";

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
  assertOwnerIdForMutation(input.ownerId, "saveSearch");
  const db = getRnpmDb(input.ownerId);
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
  const db = getRnpmDb(opts.ownerId);
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

export function updateSearchTotal(id: number, totalResults: number, ownerId: string): boolean {
  assertOwnerIdForMutation(ownerId, "updateSearchTotal");
  const db = getRnpmDb(ownerId);
  const res = db
    .prepare("UPDATE rnpm_searches SET total_results = ? WHERE id = ? AND owner_id = ?")
    .run(totalResults, id, ownerId);
  return res.changes > 0;
}

export function deleteSearch(id: number, ownerId: string): boolean {
  assertOwnerIdForMutation(ownerId, "deleteSearch");
  const db = getRnpmDb(ownerId);
  const res = db.prepare("DELETE FROM rnpm_searches WHERE id = ? AND owner_id = ?").run(id, ownerId);
  return res.changes > 0;
}

// v2.43.0 (rnpm-split): id-urile de search sunt namespace PER FISIER USER — un id
// al altui owner nu mai e observabil (fisierul lui nici nu e deschis), deci starea
// "foreign" a disparut din contract. Garda de tenant (audit 2026-04-29 #11) e acum
// izolarea fizica insasi. "missing" ramane benign: searchId cache-uit in UI dupa
// "Sterge baza" sau dupa un restore la un snapshot anterior.
export type SearchOwnership = "owned" | "missing";

export function getSearchOwnership(id: number, ownerId: string): SearchOwnership {
  const db = getRnpmDb(ownerId);
  const row = db.prepare("SELECT id FROM rnpm_searches WHERE id = ? AND owner_id = ? LIMIT 1").get(id, ownerId) as
    | { id: number }
    | undefined;
  return row ? "owned" : "missing";
}

export function searchBelongsToOwner(id: number, ownerId: string): boolean {
  return getSearchOwnership(id, ownerId) === "owned";
}

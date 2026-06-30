// apiTokenRepository.ts — Personal Access Tokens (piesa A, web mode).
// Token opac `ld_pat_*`, hash SHA-256 (lookup pe coloana indexata). Fara cache
// pozitiv: validarea se face la fiecare request (revoke instant). SQL raw doar aici.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getDb } from "./schema.ts";
import { assertOwnerIdForMutation } from "../util/ownerGuard.ts";

export const TOKEN_PREFIX = "ld_pat_";

export interface ApiTokenRow {
  id: string;
  owner_id: string;
  name: string;
  token_hash: string;
  token_prefix: string;
  scopes: string;
  captcha_daily_cap: number | null;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  last_used_ip: string | null;
  last_used_ua: string | null;
  revoked_at: string | null;
}

export function hashToken(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

// Token = ld_pat_ + 32 bytes base64url (256-bit). Prefix afisat DOAR la inceput
// (review: nu head+tail) — destul pentru identificare, fara a reduce entropia.
export function generateToken(): { secret: string; prefix: string; hash: string } {
  const body = randomBytes(32).toString("base64url");
  const secret = TOKEN_PREFIX + body;
  const prefix = TOKEN_PREFIX + body.slice(0, 8);
  return { secret, prefix, hash: hashToken(secret) };
}

export function createApiToken(input: {
  ownerId: string;
  name: string;
  scopes: string[];
  captchaDailyCap: number | null;
  expiresAt: string | null;
}): { row: ApiTokenRow; secret: string } {
  assertOwnerIdForMutation(input.ownerId, "createApiToken");
  const { secret, prefix, hash } = generateToken();
  const id = randomUUID();
  const db = getDb();
  db.prepare(
    `INSERT INTO api_tokens
       (id, owner_id, name, token_hash, token_prefix, scopes, captcha_daily_cap, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.ownerId, input.name, hash, prefix, input.scopes.join(","), input.captchaDailyCap, input.expiresAt);
  const row = db.prepare("SELECT * FROM api_tokens WHERE id = ?").get(id) as ApiTokenRow;
  return { row, secret };
}

// Lookup pe hash indexat. Valid = nerevocat + neexpirat. Fara cache pozitiv:
// fiecare request face acest lookup -> revoke instant.
export function findActiveTokenByHash(hash: string): ApiTokenRow | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM api_tokens
        WHERE token_hash = ?
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`
    )
    .get(hash) as ApiTokenRow | undefined;
  return row ?? null;
}

export function listTokensByOwner(ownerId: string): ApiTokenRow[] {
  return getDb()
    .prepare("SELECT * FROM api_tokens WHERE owner_id = ? ORDER BY created_at DESC")
    .all(ownerId) as ApiTokenRow[];
}

export function revokeToken(ownerId: string, id: string): boolean {
  assertOwnerIdForMutation(ownerId, "revokeToken");
  const info = getDb()
    .prepare(
      // ISO-Z peste tot: coloanele de timp raman comparabile intre ele si se
      // serializeaza corect catre UI (new Date(...) parseaza ISO-Z ca UTC, nu local).
      "UPDATE api_tokens SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND owner_id = ? AND revoked_at IS NULL"
    )
    .run(id, ownerId);
  return info.changes > 0;
}

export function revokeAllTokens(ownerId: string): number {
  assertOwnerIdForMutation(ownerId, "revokeAllTokens");
  const info = getDb()
    .prepare(
      "UPDATE api_tokens SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE owner_id = ? AND revoked_at IS NULL"
    )
    .run(ownerId);
  return info.changes;
}

// Pentru DELETE idempotent (PAT-009): exista tokenul (orice stare) la acest owner?
export function tokenExistsForOwner(ownerId: string, id: string): boolean {
  return (
    getDb().prepare("SELECT 1 FROM api_tokens WHERE id = ? AND owner_id = ? LIMIT 1").get(id, ownerId) !== undefined
  );
}

// Plafonul captcha per-token (A5.3); null = fara plafon dedicat (mosteneste bugetul per-user).
export function getTokenCaptchaCap(tokenId: string): number | null {
  const row = getDb().prepare("SELECT captcha_daily_cap FROM api_tokens WHERE id = ?").get(tokenId) as
    | { captcha_daily_cap: number | null }
    | undefined;
  return row?.captcha_daily_cap ?? null;
}

// Throttle ~60s: evita un write pe fiecare request. ip/ua se actualizeaza la
// fel de des; detectia de IP nou se face separat din audit (Task 11).
export function touchLastUsed(id: string, ip: string | null, ua: string | null): void {
  getDb()
    .prepare(
      `UPDATE api_tokens
          SET last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), last_used_ip = ?, last_used_ua = ?
        WHERE id = ?
          AND (last_used_at IS NULL OR last_used_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now','-60 seconds'))`
    )
    .run(ip, ua, id);
}

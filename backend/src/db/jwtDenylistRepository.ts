import { getDb } from "./schema.ts";
import { assertOwnerIdForMutation } from "../util/ownerGuard.ts";

export function revokeJti(jti: string, expiresAtSec: number, ownerId: string): void {
  assertOwnerIdForMutation(ownerId, "revokeJti");
  getDb()
    .prepare(
      `INSERT INTO jwt_denylist (jti, owner_id, expires_at, revoked_at)
       VALUES (?, ?, ?, unixepoch())
       ON CONFLICT(jti) DO NOTHING`
    )
    .run(jti, ownerId, expiresAtSec);
}

export function isJtiRevoked(jti: string): boolean {
  return getDb().prepare("SELECT 1 FROM jwt_denylist WHERE jti = ?").get(jti) !== undefined;
}

export function purgeExpiredJti(nowSec: number = Math.floor(Date.now() / 1000)): number {
  return getDb().prepare("DELETE FROM jwt_denylist WHERE expires_at < ?").run(nowSec).changes;
}

export function countRevokedJti(): number {
  return (getDb().prepare("SELECT COUNT(*) AS n FROM jwt_denylist").get() as { n: number }).n;
}

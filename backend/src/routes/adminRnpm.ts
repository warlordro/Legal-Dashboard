// v2.43.x (admin rnpm storage): vizibilitate admin pe consumul de disc RNPM
// per user — fisierul viu (db+wal+shm) si jail-ul de backup-uri. Read-only,
// envelope standard, fara audit (paritate cu GET /api/v1/admin/backups).
// Erorile FS non-ENOENT se propaga -> appErrorHandler -> 500 pe envelope.
import { Hono } from "hono";
import { listRnpmBackups, withMaintenanceRead } from "../db/backup.ts";
import { getRnpmStorageLimitBytes, measureRnpmStorage } from "../db/rnpmStorageLimit.ts";
import { listAllUserIdentities } from "../db/userRepository.ts";
import { requireRole } from "../middleware/requireRole.ts";
import { ok } from "../util/envelope.ts";

export const adminRnpmRouter = new Hono();
adminRnpmRouter.use("*", requireRole("admin"));

export interface AdminRnpmUsageRow {
  userId: string;
  email: string;
  displayName: string;
  status: string;
  dbSizeBytes: number | null;
  storageLimitBytes: number | null;
  backupCount: number;
  backupsBytes: number;
}

adminRnpmRouter.get("/usage", async (c) => {
  const users = listAllUserIdentities(); // ordinea (email ASC) e contractul repository-ului
  // Fix review Codex: citirile (stat main/wal/shm + listarea backup-urilor)
  // ruleaza sub maintenance READ lock — un compact/restore concurent (writer)
  // nu mai poate face swap intre stat-uri, deci randul nu insumeaza generatii
  // diferite ale aceluiasi fisier si nu raporteaza tranzitoriu "fara baza".
  const rows: AdminRnpmUsageRow[] = [];
  for (const u of users) {
    const storage = await measureRnpmStorage(u.id);
    const backups = await withMaintenanceRead(() => listRnpmBackups(u.id));
    rows.push({
      userId: u.id,
      email: u.email,
      displayName: u.display_name,
      status: u.status,
      dbSizeBytes: storage.exists ? storage.usedBytes : null,
      storageLimitBytes: getRnpmStorageLimitBytes(u.id),
      backupCount: backups.length,
      backupsBytes: backups.reduce((sum, b) => sum + b.sizeBytes, 0),
    });
  }
  return c.json(ok({ rows }, c));
});

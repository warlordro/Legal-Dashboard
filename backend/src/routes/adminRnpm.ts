// v2.43.x (admin rnpm storage): vizibilitate admin pe consumul de disc RNPM
// per user — fisierul viu (db+wal+shm) si jail-ul de backup-uri. Read-only,
// envelope standard, fara audit (paritate cu GET /api/v1/admin/backups).
// Erorile FS non-ENOENT se propaga -> appErrorHandler -> 500 pe envelope.
import { Hono } from "hono";
import fsPromises from "node:fs/promises";
import { listRnpmBackups, withMaintenanceRead } from "../db/backup.ts";
import { getRnpmDbPath } from "../db/rnpmDb.ts";
import { listAllUserIdentities } from "../db/userRepository.ts";
import { requireRole } from "../middleware/requireRole.ts";
import { ok } from "../util/envelope.ts";

export const adminRnpmRouter = new Hono();
adminRnpmRouter.use("*", requireRole("admin"));

// DOAR ENOENT inseamna absent (semantica v2.43.0); EACCES/EIO se propaga.
async function sizeOrNull(p: string): Promise<number | null> {
  try {
    return (await fsPromises.stat(p)).size;
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw e;
  }
}

export interface AdminRnpmUsageRow {
  userId: string;
  email: string;
  displayName: string;
  status: string;
  dbSizeBytes: number | null;
  backupCount: number;
  backupsBytes: number;
}

adminRnpmRouter.get("/usage", async (c) => {
  const users = listAllUserIdentities(); // ordinea (email ASC) e contractul repository-ului
  // Fix review Codex: citirile (stat main/wal/shm + listarea backup-urilor)
  // ruleaza sub maintenance READ lock — un compact/restore concurent (writer)
  // nu mai poate face swap intre stat-uri, deci randul nu insumeaza generatii
  // diferite ale aceluiasi fisier si nu raporteaza tranzitoriu "fara baza".
  const rows = await withMaintenanceRead(async () => {
    const acc: AdminRnpmUsageRow[] = [];
    for (const u of users) {
      const dbPath = getRnpmDbPath(u.id); // pur read-only: NU provisioneaza (asta face doar getRnpmDb)
      const main = await sizeOrNull(dbPath);
      const wal = main === null ? null : await sizeOrNull(`${dbPath}-wal`);
      const shm = main === null ? null : await sizeOrNull(`${dbPath}-shm`);
      // listRnpmBackups: filtrare RNPM_PREFIX + sufix; jail absent (ENOENT) => [];
      // EACCES/EIO se propaga. sizeBytes = snapshot self-contained (VACUUM INTO);
      // sidecar-urile bundle-urilor legacy nu sunt numarate (subestimare acceptata).
      const backups = await listRnpmBackups(u.id);
      acc.push({
        userId: u.id,
        email: u.email,
        displayName: u.display_name,
        status: u.status,
        dbSizeBytes: main === null ? null : main + (wal ?? 0) + (shm ?? 0),
        backupCount: backups.length,
        backupsBytes: backups.reduce((sum, b) => sum + b.sizeBytes, 0),
      });
    }
    return acc;
  });
  return c.json(ok({ rows }, c));
});

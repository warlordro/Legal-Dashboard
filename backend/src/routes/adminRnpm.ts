// v2.43.x (admin rnpm storage): vizibilitate admin pe consumul de disc RNPM
// per user — fisierul viu (db+wal+shm) si jail-ul de backup-uri. Read-only,
// envelope standard, fara audit (paritate cu GET /api/v1/admin/backups).
// Erorile FS non-ENOENT se propaga -> appErrorHandler -> 500 pe envelope.
import { Hono } from "hono";
import { z } from "zod";
import { listRnpmBackups, withMaintenanceRead } from "../db/backup.ts";
import { getRnpmStorageLimitBytes, measureRnpmStorage } from "../db/rnpmStorageLimit.ts";
import { listAllUserIdentities } from "../db/userRepository.ts";
import { requireRole } from "../middleware/requireRole.ts";
import { ErrorCodes, fail, ok } from "../util/envelope.ts";

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

// CodeRabbit 1.6: ruta intorcea TOTI userii, iar pentru fiecare facea, serial,
// masuratori de fisier (stat db/wal/shm) plus listarea directorului de backup-uri.
// La cativa useri e in regula; la cateva sute devine o cerere lenta si nelimitata.
// Paginare dupa modelul ListUsersQuerySchema din admin.ts — forma { rows, page,
// pageSize, total } e conventia web-readiness din CLAUDE.md.
// Nota: forma veche (lista simpla) era DELIBERATA, pentru paritate cu
// GET /api/v1/admin/backups; schimbarea e o imbunatatire de scalare, nu repararea
// unei incalcari de conventie.
const UsageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

adminRnpmRouter.get("/usage", async (c) => {
  const parsed = UsageQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json(fail(ErrorCodes.INVALID_PARAMS, "Parametri de paginare invalizi.", c, parsed.error.issues), 400);
  }
  const { page, pageSize } = parsed.data;
  const allUsers = listAllUserIdentities(); // ordinea (email ASC) e contractul repository-ului
  const total = allUsers.length;
  // Feliem INAINTE de bucla: costul per rand e I/O pe disc, deci paginarea trebuie sa
  // reduca munca efectiva, nu doar raspunsul.
  const users = allUsers.slice((page - 1) * pageSize, page * pageSize);
  // Fix review Codex: citirile (stat main/wal/shm + listarea backup-urilor)
  // ruleaza sub maintenance READ lock — un compact/restore concurent (writer)
  // nu mai poate face swap intre stat-uri, deci randul nu insumeaza generatii
  // diferite ale aceluiasi fisier si nu raporteaza tranzitoriu "fara baza".
  //
  // Corectie (review adversarial, convergent pe 5 revieweri): pana acum DOAR
  // listRnpmBackups era sub lock, iar measureRnpmStorage rula in afara lui — exact
  // race-ul pe care comentariul il declara inchis. Un singur `withMaintenanceRead` in
  // jurul intregii bucle il inchide efectiv si evita si N asteptari pe lock per cerere.
  const rows: AdminRnpmUsageRow[] = await withMaintenanceRead(async () => {
    const acc: AdminRnpmUsageRow[] = [];
    for (const u of users) {
      const storage = await measureRnpmStorage(u.id);
      const backups = await listRnpmBackups(u.id);
      acc.push({
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
    return acc;
  });
  return c.json(ok({ rows, page, pageSize, total }, c));
});

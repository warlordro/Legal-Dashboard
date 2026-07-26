// v2.43.x (admin rnpm storage): vizibilitate admin pe consumul de disc RNPM
// per user — fisierul viu (db+wal+shm) si jail-ul de backup-uri. Read-only,
// envelope standard, fara audit (paritate cu GET /api/v1/admin/backups).
// Erorile FS non-ENOENT se propaga -> appErrorHandler -> 500 pe envelope.
import fs from "node:fs";
import { Hono } from "hono";
import { z } from "zod";
import { getRnpmBackupDir, listRnpmBackups, withMaintenanceRead } from "../db/backup.ts";
import { getRnpmDbPath } from "../db/rnpmDb.ts";
import { getRnpmStorageLimitBytes, measureRnpmStorageUnlocked } from "../db/rnpmStorageLimit.ts";
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
  // Filtrul de useri inactivi era client-side, DUPA paginare (finding review): o pagina
  // intreaga putea aparea goala desi paginile urmatoare aveau date, iar "X-Y din N"
  // numara alt set decat afisa tabelul. Mutat pe server, inaintea felierii.
  includeInactive: z
    .enum(["0", "1", "true", "false"])
    .optional()
    .transform((v) => v === "1" || v === "true"),
});

// Predicat IEFTIN, fara stat/readdir: doar existenta cailor. Se aplica exclusiv userilor
// non-activi, deci costul e proportional cu ei, nu cu totalul. Erorile de acces intorc
// `false` la existsSync, dar directia de eroare e spre AFISARE (un user cu backup-uri nu
// dispare din lista adminului doar pentru ca fisierul viu lipseste).
function hasRnpmFootprint(ownerId: string): boolean {
  try {
    return fs.existsSync(getRnpmDbPath(ownerId)) || fs.existsSync(getRnpmBackupDir(ownerId));
  } catch {
    return true;
  }
}

adminRnpmRouter.get("/usage", async (c) => {
  const parsed = UsageQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json(fail(ErrorCodes.INVALID_PARAMS, "Parametri de paginare invalizi.", c, parsed.error.issues), 400);
  }
  const { page, pageSize, includeInactive } = parsed.data;
  const allUsers = listAllUserIdentities(); // ordinea (email ASC) e contractul repository-ului
  const candidates = includeInactive
    ? allUsers
    : allUsers.filter((u) => u.status === "active" || hasRnpmFootprint(u.id));
  const total = candidates.length;
  // Feliem INAINTE de bucla: costul per rand e I/O pe disc, deci paginarea trebuie sa
  // reduca munca efectiva, nu doar raspunsul.
  const users = candidates.slice((page - 1) * pageSize, page * pageSize);
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
      // Varianta UNLOCKED: read-ul de mentenanta e deja luat de blocul exterior, iar
      // RWLock-ul e nereentrant si writer-preference — un al doilea read cerut aici s-ar
      // aseza dupa orice writer intrat la coada intre timp, blocand permanent si
      // writer-ul (care asteapta read-ul exterior). Vezi rnpmStorageLimit.ts.
      const storage = await measureRnpmStorageUnlocked(u.id);
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

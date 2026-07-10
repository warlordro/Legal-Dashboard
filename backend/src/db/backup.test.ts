import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { discoverMigrations } from "./migrations/runner.ts";
import { Hono } from "hono";
import {
  __resetMaintenanceShutdownForTests,
  __uniqueManualBackupNameForTests,
  createManualBackup,
  deleteAllBackups,
  getBackupDir,
  listBackupsWithMeta,
  markMaintenanceShuttingDown,
  restoreFromBackup,
  runDailyBackup,
  waitForBackupToSettle,
  withMaintenanceRead,
  withMaintenanceWrite,
} from "./backup.ts";
import { requestIdContext } from "../middleware/requestId.ts";
import { meRouter } from "../routes/me.ts";
import { appErrorHandler } from "../util/appErrorHandler.ts";
import { clearMonolithRestoreInProgress, closeDb, getDb, setMonolithRestoreInProgress } from "./schema.ts";

// Capture console.log during the body — vi.spyOn does not intercept reliably
// across the maintenance-lock microtask hop, so override the method directly.
async function captureConsoleLog<T>(fn: () => Promise<T>): Promise<{ value: T; lines: string[] }> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    if (typeof args[0] === "string") lines.push(args[0]);
  };
  try {
    const value = await fn();
    return { value, lines };
  } finally {
    console.log = original;
  }
}

const __testDir = typeof __dirname !== "undefined" ? __dirname : path.dirname(fileURLToPath(import.meta.url));

let tmpRoot: string;
let dbPath: string;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-backup-test-"));
  dbPath = path.join(tmpRoot, "legal-dashboard.db");
  process.env.LEGAL_DASHBOARD_DB_PATH = dbPath;
  const db = new Database(dbPath);
  db.exec("CREATE TABLE marker (label TEXT)");
  db.prepare("INSERT INTO marker(label) VALUES (?)").run("LIVE");
  db.close();
});

afterEach(async () => {
  closeDb();
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

async function seedBackup(name: string, label: string): Promise<void> {
  const dir = getBackupDir();
  await fsPromises.mkdir(dir, { recursive: true });
  const backupPath = path.join(dir, name);
  const db = new Database(backupPath);
  db.exec("CREATE TABLE marker (label TEXT)");
  db.prepare("INSERT INTO marker(label) VALUES (?)").run(label);
  db.close();
}

async function seedOldBackup(name: string, label: string): Promise<void> {
  await seedBackup(name, label);
  const old = new Date("2020-01-01T00:00:00.000Z");
  await fsPromises.utimes(path.join(getBackupDir(), name), old, old);
}

function readMarker(p: string): string {
  const db = new Database(p, { readonly: true });
  try {
    const row = db.prepare("SELECT label FROM marker LIMIT 1").get() as { label: string };
    return row.label;
  } finally {
    db.close();
  }
}

describe("restoreFromBackup — atomicity + safety", () => {
  it("replaces the live DB with the backup contents", async () => {
    const backupName = "legal-dashboard.2026-04-15.db";
    await seedBackup(backupName, "RESTORED");

    const result = await restoreFromBackup(backupName);

    expect(result.preRestoreName).toMatch(/^legal-dashboard\.pre-restore-.+\.db$/);
    expect(readMarker(dbPath)).toBe("RESTORED");
  });

  it("creates a pre-restore snapshot of the live DB before overwriting", async () => {
    const backupName = "legal-dashboard.2026-04-15.db";
    await seedBackup(backupName, "RESTORED");

    const { preRestoreName } = await restoreFromBackup(backupName);
    const preRestorePath = path.join(getBackupDir(), preRestoreName);

    expect(fs.existsSync(preRestorePath)).toBe(true);
    expect(readMarker(preRestorePath)).toBe("LIVE");
  });

  it("removes stale WAL/SHM sidecars after restore", async () => {
    await fsPromises.writeFile(dbPath + "-wal", "stale wal");
    await fsPromises.writeFile(dbPath + "-shm", "stale shm");

    const backupName = "legal-dashboard.2026-04-15.db";
    await seedBackup(backupName, "RESTORED");

    await restoreFromBackup(backupName);

    expect(fs.existsSync(dbPath + "-wal")).toBe(false);
    expect(fs.existsSync(dbPath + "-shm")).toBe(false);
  });

  it("does not leave staging artifacts alongside the live DB on success", async () => {
    const backupName = "legal-dashboard.2026-04-15.db";
    await seedBackup(backupName, "RESTORED");

    await restoreFromBackup(backupName);

    // Rev. 3 (panel LOW): asertia veche verifica numele `.restore.tmp`, pe
    // care implementarea pe staging nu il mai produce — trecea trivial.
    expect(fs.existsSync(`${dbPath}.restore-staging`)).toBe(false);
  });

  it("rejects path-traversal attempts", async () => {
    await expect(restoreFromBackup("../etc/passwd")).rejects.toThrow(/invalid/i);
    await expect(restoreFromBackup("..\\boot.ini")).rejects.toThrow(/invalid/i);
    await expect(restoreFromBackup("legal-dashboard. .db")).rejects.toThrow(/invalid/i);
  });

  it("rejects names that do not match the backup pattern", async () => {
    await expect(restoreFromBackup("evil.db")).rejects.toThrow(/invalid/i);
    await expect(restoreFromBackup("legal-dashboard.db")).rejects.toThrow(/invalid/i);
  });

  it("rejects a missing backup with a clear error", async () => {
    await expect(restoreFromBackup("legal-dashboard.does-not-exist.db")).rejects.toThrow(/inexistent/i);
  });

  it("skips pre-restore snapshot when live DB does not exist (first-boot restore)", async () => {
    // Simulate fresh install scenario: the user imports a backup before any
    // local DB exists. There's nothing to snapshot, so pre-restore must not
    // try to copy a missing source — that would throw and block restore.
    closeDb();
    await fsPromises.unlink(dbPath);

    const backupName = "legal-dashboard.2026-04-15.db";
    await seedBackup(backupName, "RESTORED");

    const { preRestoreName } = await restoreFromBackup(backupName);

    // No pre-restore file created, but the name is still returned for UX
    // consistency (UI shows "rollback la <name>" — disabled when missing).
    expect(fs.existsSync(path.join(getBackupDir(), preRestoreName))).toBe(false);
    // Restore itself still applies.
    expect(readMarker(dbPath)).toBe("RESTORED");
  });

  it("emits a structured audit line on successful restore", async () => {
    const backupName = "legal-dashboard.2026-04-15.db";
    await seedBackup(backupName, "RESTORED");

    const { lines } = await captureConsoleLog(() => restoreFromBackup(backupName));

    const restoreLine = lines.find((s) => s.includes('"action":"restore"') && !s.includes('"restore_failed"'));
    expect(restoreLine).toBeDefined();
    const parsed = JSON.parse(restoreLine!);
    expect(parsed.action).toBe("restore");
    expect(parsed.source).toBe(backupName);
    expect(parsed.preRestoreCreated).toBe(true);
  });
});

// Rev. 4 (Codex): stampNow() trunchia la secunda, iar publish-ul suprascrie
// prin rename — doua create-uri manuale in aceeasi secunda (ruta admin nu are
// cooldown) produceau UN singur snapshot, silentios.
describe("nume unic pentru backup-ul manual (Rev. 4)", () => {
  it("acelasi stamp + fisier existent => sufix incremental, fara suprascriere", async () => {
    const dir = getBackupDir();
    await fsPromises.mkdir(dir, { recursive: true });
    const stamp = "2026-07-11T10-00-00-000Z";
    const first = __uniqueManualBackupNameForTests(dir, "legal-dashboard.", stamp);
    expect(first).toBe("legal-dashboard.manual-2026-07-11T10-00-00-000Z.db");

    fs.writeFileSync(path.join(dir, first), "x");
    const second = __uniqueManualBackupNameForTests(dir, "legal-dashboard.", stamp);
    expect(second).toBe("legal-dashboard.manual-2026-07-11T10-00-00-000Z-2.db");
    fs.writeFileSync(path.join(dir, second), "x");
    const third = __uniqueManualBackupNameForTests(dir, "legal-dashboard.", stamp);
    expect(third).toBe("legal-dashboard.manual-2026-07-11T10-00-00-000Z-3.db");
  });

  // Red COMPORTAMENTAL pe fluxul de PRODUCTIE (fix panel-pe-plan): doua
  // create-uri cu acelasi timestamp trebuie sa produca DOUA fisiere pe disc.
  // Spy-ul pe Date.prototype.toISOString traieste doar pe main thread —
  // worker-ul de snapshot e thread separat, neafectat.
  it("doua backup-uri manuale cu acelasi timestamp => doua fisiere distincte pe disc", async () => {
    const frozen = "2026-07-11T10:00:00.000Z";
    const spy = vi.spyOn(Date.prototype, "toISOString").mockReturnValue(frozen);
    let a: { name: string };
    let b: { name: string };
    try {
      a = await createManualBackup();
      b = await createManualBackup();
    } finally {
      spy.mockRestore();
    }
    expect(a.name).not.toBe(b.name);
    expect(fs.existsSync(path.join(getBackupDir(), a.name))).toBe(true);
    expect(fs.existsSync(path.join(getBackupDir(), b.name))).toBe(true);
  });
});

describe("deleteAllBackups — audit log", () => {
  it("emits a delete_all_backups audit line with deleted count and total", async () => {
    await seedBackup("legal-dashboard.2026-04-10.db", "A");
    await seedBackup("legal-dashboard.2026-04-11.db", "B");
    await seedBackup("legal-dashboard.2026-04-12.db", "C");

    const { value: deleted, lines } = await captureConsoleLog(() => deleteAllBackups());
    expect(deleted).toBe(3);

    const auditLine = lines.find((s) => s.includes('"action":"delete_all_backups"'));
    expect(auditLine).toBeDefined();
    const parsed = JSON.parse(auditLine!);
    expect(parsed.deleted).toBe(3);
    expect(parsed.total).toBe(3);
    expect(typeof parsed.ts).toBe("string");
  });
});

// Task 2 (fixuri post-review): delete-all pe monolit serializat sub
// maintenance lock — cerut explicit de review-panel, pandantul testului rnpm.
describe("deleteAllBackups — serializare sub maintenance lock", () => {
  it("nu sterge nimic cat timp un writer tine lock-ul; sterge dupa eliberare", async () => {
    await seedBackup("legal-dashboard.2026-04-10.db", "A");
    const backupPath = path.join(getBackupDir(), "legal-dashboard.2026-04-10.db");

    let releaseWriter: () => void = () => undefined;
    const writer = withMaintenanceWrite(
      () =>
        new Promise<void>((resolve) => {
          releaseWriter = resolve;
        })
    );
    await new Promise((r) => setImmediate(r));

    const del = deleteAllBackups();
    try {
      for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
      expect(fs.existsSync(backupPath)).toBe(true);
    } finally {
      // Elibereaza lock-ul MODULULUI si pe esec de asertie — altfel un red
      // aici otraveste toate testele urmatoare din fisier (timeout in cascada).
      releaseWriter();
      await writer;
      await del.catch(() => undefined);
    }
    expect(await del).toBe(1);
    expect(fs.existsSync(backupPath)).toBe(false);
  });
});

describe("runDailyBackup — atomicity + retention", () => {
  it("removes orphan .db.tmp files before writing the daily backup", async () => {
    const dir = getBackupDir();
    await fsPromises.mkdir(dir, { recursive: true });
    const orphanTmp = path.join(dir, "legal-dashboard.2026-04-15.db.tmp");
    const unrelatedTmp = path.join(dir, "notes.db.tmp");
    await fsPromises.writeFile(orphanTmp, "partial backup");
    await fsPromises.writeFile(unrelatedTmp, "not ours");

    await runDailyBackup();

    expect(fs.existsSync(orphanTmp)).toBe(false);
    expect(fs.existsSync(unrelatedTmp)).toBe(true);
    const names = (await listBackupsWithMeta()).map((b) => b.name);
    expect(names.some((name) => /^legal-dashboard\.\d{4}-\d{2}-\d{2}\.db$/.test(name))).toBe(true);
    expect(names.some((name) => name.endsWith(".db.tmp"))).toBe(false);
  });

  it("prunes dated, pre-restore, and pre-migration backups in separate pools", async () => {
    for (let i = 1; i <= 8; i++) {
      await seedOldBackup(`legal-dashboard.2020-01-${String(i).padStart(2, "0")}.db`, `DAILY-${i}`);
    }
    for (let i = 1; i <= 7; i++) {
      await seedOldBackup(`legal-dashboard.pre-restore-2020-01-${String(i).padStart(2, "0")}.db`, `RESTORE-${i}`);
    }
    for (let i = 1; i <= 7; i++) {
      await seedOldBackup(`legal-dashboard.pre-schema-2020010${i}.db`, `MIGRATION-${i}`);
    }

    await runDailyBackup();

    const names = (await listBackupsWithMeta()).map((b) => b.name);
    const dated = names.filter((name) => /^legal-dashboard\.\d{4}-\d{2}-\d{2}\.db$/.test(name));
    const preRestore = names.filter((name) => /^legal-dashboard\.pre-restore-/.test(name));
    const preMigration = names.filter((name) => /^legal-dashboard\.pre-(?!restore-)[^.]+\.db$/.test(name));

    expect(dated).toHaveLength(7);
    expect(preRestore).toHaveLength(5);
    expect(preMigration).toHaveLength(5);
    expect(preMigration).toContain("legal-dashboard.pre-schema-20200107.db");
    expect(preMigration).not.toContain("legal-dashboard.pre-schema-20200101.db");
    // 22 seeded backups + runDailyBackup = heavy real file I/O; the 5s default
    // testTimeout flakes on slow CI runners (Windows + Defender). Generous budget.
  }, 30_000);

  // Task 2 (fixuri post-review): pool EXPLICIT pentru pre-rnpm-split — altfel
  // cade in preMigration si sorteaza lexicografic DUPA pre-schema-upgrade
  // (evacuat primul, desi e rollback-ul split-ului).
  it("pool preSplit separat: pastreaza 3 pre-rnpm-split + 5 pre-schema-upgrade, fara furt intre pool-uri", async () => {
    for (let i = 1; i <= 4; i++) {
      await seedOldBackup(`legal-dashboard.pre-rnpm-split-2020-01-0${i}T00-00-0${i}.db`, `SPLIT-${i}`);
    }
    for (let i = 1; i <= 6; i++) {
      await seedOldBackup(`legal-dashboard.pre-schema-upgrade-2020-01-0${i}T00-00-0${i}.db`, `UPG-${i}`);
    }

    await runDailyBackup();

    const names = (await listBackupsWithMeta()).map((b) => b.name);
    const split = names.filter((n) => n.startsWith("legal-dashboard.pre-rnpm-split-"));
    const upgrade = names.filter((n) => n.startsWith("legal-dashboard.pre-schema-upgrade-"));
    expect(split).toHaveLength(3);
    expect(split).toContain("legal-dashboard.pre-rnpm-split-2020-01-04T00-00-04.db");
    expect(split).not.toContain("legal-dashboard.pre-rnpm-split-2020-01-01T00-00-01.db");
    expect(upgrade).toHaveLength(5);
    expect(upgrade).toContain("legal-dashboard.pre-schema-upgrade-2020-01-06T00-00-06.db");
    expect(upgrade).not.toContain("legal-dashboard.pre-schema-upgrade-2020-01-01T00-00-01.db");
  }, 30_000);
});

// v2.34.0 P1-8: optional offsite upload hook on `LEGAL_DASHBOARD_BACKUP_OFFSITE_CMD`.
// POSIX-only because the impl uses `sh -c` on linux/darwin and `cmd /c` on win32;
// `true` / `false` are POSIX shell builtins — Windows test runner would need
// `exit /b 0` / `exit /b 1` instead, but the deployment surface that actually
// uses this hook is the Docker image (ubuntu-latest).
describe("runDailyBackup — offsite hook (POSIX only)", () => {
  const isWindows = process.platform === "win32";

  afterEach(() => {
    // biome-ignore lint/performance/noDelete: env must be truly unset.
    delete process.env.LEGAL_DASHBOARD_BACKUP_OFFSITE_CMD;
  });

  it.skipIf(isWindows)("hook unset = no offsite_backup log emitted", async () => {
    const { lines } = await captureConsoleLog(() => runDailyBackup());
    expect(lines.some((s) => s.includes('"action":"offsite_backup"'))).toBe(false);
    expect(lines.some((s) => s.includes('"action":"offsite_backup_failed"'))).toBe(false);
  });

  it.skipIf(isWindows)("hook exit 0 emits offsite_backup success line with file + duration", async () => {
    process.env.LEGAL_DASHBOARD_BACKUP_OFFSITE_CMD = "true";
    const { lines } = await captureConsoleLog(() => runDailyBackup());

    const successLine = lines.find(
      (s) => s.includes('"action":"offsite_backup"') && !s.includes("offsite_backup_failed")
    );
    expect(successLine).toBeDefined();
    const parsed = JSON.parse(successLine!);
    expect(parsed.action).toBe("offsite_backup");
    expect(parsed.file).toMatch(/^legal-dashboard\.\d{4}-\d{2}-\d{2}\.db$/);
    expect(typeof parsed.durationMs).toBe("number");
  });

  it.skipIf(isWindows)("hook exit non-zero emits offsite_backup_failed with exit code + stderr", async () => {
    process.env.LEGAL_DASHBOARD_BACKUP_OFFSITE_CMD = "echo boom 1>&2; exit 7";
    const { lines } = await captureConsoleLog(() => runDailyBackup());

    const failureLine = lines.find((s) => s.includes('"action":"offsite_backup_failed"'));
    expect(failureLine).toBeDefined();
    const parsed = JSON.parse(failureLine!);
    expect(parsed.action).toBe("offsite_backup_failed");
    expect(parsed.exitCode).toBe(7);
    expect(parsed.stage).toBe("exit");
    expect(parsed.stderr).toContain("boom");
  });

  it.skipIf(isWindows)("hook failure does NOT remove the local backup", async () => {
    process.env.LEGAL_DASHBOARD_BACKUP_OFFSITE_CMD = "false";
    await runDailyBackup();

    const names = (await listBackupsWithMeta()).map((b) => b.name);
    const dated = names.filter((name) => /^legal-dashboard\.\d{4}-\d{2}-\d{2}\.db$/.test(name));
    // Hook failure is fail-open: local backup persists, only the offsite leg failed.
    expect(dated.length).toBeGreaterThanOrEqual(1);
  });
});

// Rev. 3 (Codex H1): ledger-ul de migratii al backup-ului trebuie sa fie
// coerent cu migratiile cunoscute (hash-uri + prefix contiguu 1..N) INAINTE de
// publicare — altfel runner-ul il respinge abia la urmatorul open, dupa
// fereastra de auto-revert.
describe("restore monolit — validare ledger (Rev. 3)", () => {
  function forgeLedger(backupName: string, rows: Array<{ version: number; hash: string }>): void {
    const forge = new Database(path.join(getBackupDir(), backupName));
    try {
      forge.exec(
        "CREATE TABLE IF NOT EXISTS _schema_versions (version INTEGER PRIMARY KEY, sha256_up TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')))"
      );
      for (const r of rows) {
        forge
          .prepare("INSERT OR REPLACE INTO _schema_versions (version, sha256_up) VALUES (?, ?)")
          .run(r.version, r.hash);
      }
    } finally {
      forge.close();
    }
  }

  it("ledger cu hash gresit la o versiune cunoscuta => 400, live neatins", async () => {
    const backupName = "legal-dashboard.2026-06-01.db";
    await seedBackup(backupName, "FORGED");
    forgeLedger(backupName, [{ version: 1, hash: "hash-forjat" }]);

    await expect(restoreFromBackup(backupName)).rejects.toMatchObject({ code: "INVALID_PARAMS" });
    expect(readMarker(dbPath)).toBe("LIVE");
  });

  it("ledger cu GAURA (incepe la 3, fara 1-2) => 400 (prefix contiguu obligatoriu)", async () => {
    const backupName = "legal-dashboard.2026-06-05.db";
    await seedBackup(backupName, "GAPPED");
    const v3 = discoverMigrations(path.join(__testDir, "migrations")).find((f) => f.version === 3);
    if (!v3) throw new Error("fixture: migratia 3 lipseste");
    forgeLedger(backupName, [{ version: 3, hash: v3.sha256 }]);

    await expect(restoreFromBackup(backupName)).rejects.toMatchObject({ code: "INVALID_PARAMS" });
    expect(readMarker(dbPath)).toBe("LIVE");
  });

  it("ledger cu versiune invalida (0) => 400", async () => {
    const backupName = "legal-dashboard.2026-06-06.db";
    await seedBackup(backupName, "ZEROVER");
    forgeLedger(backupName, [{ version: 0, hash: "orice" }]);

    await expect(restoreFromBackup(backupName)).rejects.toMatchObject({ code: "INVALID_PARAMS" });
  });

  it("ledger cu sentinel de backfill pe versiunea 1 + restul contiguu cu hash-uri reale => ACCEPTAT", async () => {
    const backupName = "legal-dashboard.2026-06-02.db";
    await seedBackup(backupName, "LEGACY");
    const known = discoverMigrations(path.join(__testDir, "migrations"));
    forgeLedger(backupName, [
      { version: 1, hash: "__backfilled_v1__" },
      ...known.filter((f) => f.version > 1).map((f) => ({ version: f.version, hash: f.sha256 })),
    ]);

    await expect(restoreFromBackup(backupName)).resolves.toBeDefined();
    expect(readMarker(dbPath)).toBe("LEGACY");
  });

  it("backup FARA _schema_versions ramane acceptat la monolit (regresie)", async () => {
    const backupName = "legal-dashboard.2026-06-03.db";
    await seedBackup(backupName, "NOLEDGER");
    await expect(restoreFromBackup(backupName)).resolves.toBeDefined();
  });
});

// Rev. 3 (Codex H2): dupa split, un backup de monolit care mai contine randuri
// rnpm_* nu se mai restaureaza — inainte, restore-ul raporta succes iar
// urmatorul boot aborta fail-closed (marker done + randuri rnpm reaparute).
describe("restore monolit — gate pre-split (Rev. 3)", () => {
  function writeSplitMarker(content: string): void {
    const dir = path.join(path.dirname(dbPath), "rnpm");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, ".split-done.json"), content);
  }

  function addRnpmRows(backupName: string): void {
    const forge = new Database(path.join(getBackupDir(), backupName));
    try {
      forge.exec(
        "CREATE TABLE IF NOT EXISTS rnpm_searches (id INTEGER PRIMARY KEY, owner_id TEXT NOT NULL, search_type TEXT, params_json TEXT)"
      );
      forge.prepare("INSERT INTO rnpm_searches (owner_id, search_type, params_json) VALUES ('u1','x','{}')").run();
    } finally {
      forge.close();
    }
  }

  it("split done + backup cu randuri rnpm => 400 fail-closed, live neatins", async () => {
    const backupName = "legal-dashboard.2026-05-01.db";
    await seedBackup(backupName, "PRESPLIT");
    addRnpmRows(backupName);
    writeSplitMarker(JSON.stringify({ status: "done", completedAt: null, owners: [], appVersion: "x" }));

    await expect(restoreFromBackup(backupName)).rejects.toMatchObject({ code: "INVALID_PARAMS" });
    await expect(restoreFromBackup(backupName)).rejects.toThrow(/RUNBOOK|pre-split|separar/i);
    expect(readMarker(dbPath)).toBe("LIVE");
  });

  it("split wiping (mid-split) + backup cu randuri rnpm => acelasi refuz", async () => {
    const backupName = "legal-dashboard.2026-05-02.db";
    await seedBackup(backupName, "PRESPLIT");
    addRnpmRows(backupName);
    writeSplitMarker(JSON.stringify({ status: "wiping", completedAt: null, owners: [], appVersion: "x" }));

    await expect(restoreFromBackup(backupName)).rejects.toMatchObject({ code: "INVALID_PARAMS" });
  });

  it("marker ILIZIBIL (JSON corupt) + backup cu randuri rnpm => refuz fail-closed, nu 'split inexistent'", async () => {
    const backupName = "legal-dashboard.2026-05-05.db";
    await seedBackup(backupName, "PRESPLIT");
    addRnpmRows(backupName);
    writeSplitMarker("{ corupt");

    await expect(restoreFromBackup(backupName)).rejects.toMatchObject({ code: "INVALID_PARAMS" });
    expect(readMarker(dbPath)).toBe("LIVE");
  });

  it("fara marker (split inca nerulat): backup cu randuri rnpm ramane restaurabil", async () => {
    const backupName = "legal-dashboard.2026-05-03.db";
    await seedBackup(backupName, "PRESPLIT-OK");
    addRnpmRows(backupName);

    await expect(restoreFromBackup(backupName)).resolves.toBeDefined();
    expect(readMarker(dbPath)).toBe("PRESPLIT-OK");
  });

  it("marker done + backup FARA randuri rnpm ramane restaurabil", async () => {
    const backupName = "legal-dashboard.2026-05-04.db";
    await seedBackup(backupName, "POSTSPLIT");
    writeSplitMarker(JSON.stringify({ status: "done", completedAt: null, owners: [], appVersion: "x" }));

    await expect(restoreFromBackup(backupName)).resolves.toBeDefined();
    expect(readMarker(dbPath)).toBe("POSTSPLIT");
  });
});

// Task 5 (fixuri post-review): restore-ul de monolit primeste paritate cu cel
// RNPM — latch tipat pe getDb() in fereastra de restore (toate rutele 409 prin
// handlerul central; indisponibilitate globala temporara, acceptata si
// documentata) + validare de versiune de schema fail-closed.
describe("restore monolit — latch + validare versiune (Task 5)", () => {
  it("in fereastra restore-ului getDb() arunca tipat, iar snapshot-ul pre-restore PROPRIU reuseste", async () => {
    const backupName = "legal-dashboard.2026-04-15.db";
    await seedBackup(backupName, "RESTORED");

    let latchError: unknown = null;
    const { preRestoreName } = await restoreFromBackup(backupName, {
      onPhase: (phase) => {
        if (phase === "post_publish") {
          try {
            getDb();
          } catch (e) {
            latchError = e;
          }
        }
      },
    });

    // Anti-self-block: snapshot-ul pre-restore al restore-ului insusi a mers
    // (conexiune raw readonly, nu getDb-ul latch-uit).
    expect(fs.existsSync(path.join(getBackupDir(), preRestoreName))).toBe(true);
    // Latch-ul: orice getDb() strain din fereastra e refuzat tipat.
    expect(latchError).toMatchObject({ code: "RESTORE_IN_PROGRESS" });
    // Dupa restore latch-ul e curatat si baza e cea restaurata.
    expect(() => getDb()).not.toThrow();
    expect(readMarker(dbPath)).toBe("RESTORED");
  });

  it("o ruta ne-RNPM in timpul restore-ului de monolit primeste 409 prin handlerul central", async () => {
    setMonolithRestoreInProgress();
    try {
      const app = new Hono();
      app.onError(appErrorHandler);
      app.use("*", requestIdContext);
      app.use("*", async (c, next) => {
        c.set("ownerId", "local");
        await next();
      });
      app.route("/api/v1/me", meRouter);

      const res = await app.request("/api/v1/me");
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error?: { code: string } }).error?.code).toBe("RESTORE_IN_PROGRESS");
    } finally {
      clearMonolithRestoreInProgress();
    }
  });

  it("restore monolit dintr-un backup cu _schema_versions mai NOUA => 400 fail-closed, live neatins", async () => {
    const backupName = "legal-dashboard.2026-04-16.db";
    await seedBackup(backupName, "FUTURE");
    const forge = new Database(path.join(getBackupDir(), backupName));
    try {
      forge.exec(
        "CREATE TABLE _schema_versions (version INTEGER PRIMARY KEY, sha256_up TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')))"
      );
      forge.prepare("INSERT INTO _schema_versions (version, sha256_up) VALUES (9999, 'future')").run();
    } finally {
      forge.close();
    }

    await expect(restoreFromBackup(backupName)).rejects.toMatchObject({ code: "INVALID_PARAMS" });
    expect(readMarker(dbPath)).toBe("LIVE");
    // Lipsa tabelei ramane ACCEPTATA la monolit (backup-uri legacy reale) —
    // acoperita de testele de restore de mai sus (seedBackup nu creeaza
    // _schema_versions).
  });
});

// Task 4 (fixuri post-review): shutdown-ul acopera TOATE write-urile de
// mentenanta, nu doar daily-ul — flag tipat MAINTENANCE_SHUTDOWN (refuz
// INAINTE de coada lock-ului) + settle-set cu promise-urile care includ si
// timpul de asteptare pe lock.
describe("maintenance shutdown — flag tipat + settle-set (Task 4)", () => {
  afterEach(() => {
    __resetMaintenanceShutdownForTests();
  });

  it("dupa flag, un withMaintenanceWrite NOU arunca eroarea tipata si ruta raspunde 503 prin handlerul central", async () => {
    markMaintenanceShuttingDown();

    await expect(withMaintenanceWrite(async () => undefined)).rejects.toMatchObject({
      code: "MAINTENANCE_SHUTDOWN",
    });

    const app = new Hono();
    app.onError(appErrorHandler);
    app.use("*", requestIdContext);
    app.post("/op", async (c) => {
      await withMaintenanceWrite(async () => undefined);
      return c.json({ ok: true });
    });
    const res = await app.request("/op", { method: "POST" });
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toMatch(/^\d+$/);
    expect(((await res.json()) as { error?: { code: string } }).error?.code).toBe("MAINTENANCE_SHUTDOWN");
  });

  it("un writer DEJA in coada la setarea flag-ului isi termina treaba si e prins de settle-set", async () => {
    let releaseFirst: () => void = () => undefined;
    const first = withMaintenanceWrite(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        })
    );
    await new Promise((r) => setImmediate(r));

    let secondRan = false;
    const second = withMaintenanceWrite(async () => {
      secondRan = true;
    });
    await new Promise((r) => setImmediate(r));

    let settled = false;
    let wait: Promise<void> = Promise.resolve();
    try {
      // Flag-ul se seteaza cat timp `second` ASTEAPTA pe lock.
      markMaintenanceShuttingDown();

      wait = waitForBackupToSettle(5_000).then(() => {
        settled = true;
      });
      for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r));
      // Settle-ul asteapta si writer-ul din coada (promise-ul inregistrat
      // include timpul de asteptare pe lock).
      expect(settled).toBe(false);
    } finally {
      // Elibereaza lock-ul MODULULUI si pe esec — altfel un red aici
      // otraveste testele urmatoare din fisier (timeout in cascada).
      releaseFirst();
      await Promise.allSettled([first, second]);
    }
    await Promise.all([first, second, wait]);
    expect(settled).toBe(true);
    expect(secondRan).toBe(true);

    // Un writer NOU dupa flag ramane refuzat.
    await expect(withMaintenanceWrite(async () => undefined)).rejects.toMatchObject({
      code: "MAINTENANCE_SHUTDOWN",
    });
  });
});

// Regression for the maintenance RWLock: writer (backup/restore) acquired
// exclusive access blocks new readers (scheduler ticks); concurrent readers
// run in parallel; writer-preference prevents reader starvation. The lock
// primitive itself has its own unit tests (util/rwlock.test.ts) covering
// the abort/throw and ordering edge cases — these tests assert the wiring
// (same lock instance shared by withMaintenanceLock + withMaintenanceRead).
describe("maintenance RWLock — backup vs scheduler integration", () => {
  it("multiple withMaintenanceRead bodies run in parallel", async () => {
    let inFlight = 0;
    let peakInFlight = 0;
    const enter = async () => {
      inFlight++;
      if (inFlight > peakInFlight) peakInFlight = inFlight;
      // Hold the lock long enough for the other readers to acquire too.
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      inFlight--;
    };

    await Promise.all([withMaintenanceRead(enter), withMaintenanceRead(enter), withMaintenanceRead(enter)]);

    expect(peakInFlight).toBe(3);
  });

  it("queued writer (backup) blocks new readers — writer preference", async () => {
    // Reader 1 holds the lock; backup queues behind it; reader 2 arrives
    // AFTER backup. Writer-preference means r2 queues BEHIND backup, NOT
    // alongside r1 — proven by r2 staying blocked while r1 still holds.
    // (We deliberately do not assert ordering between events emitted by
    // different async chains after r1 releases — microtask scheduling can
    // reorder the IIFE's "backup-end" with r2's body even though the lock
    // is held correctly. The unit tests in util/rwlock.test.ts cover
    // post-release ordering on a single chain.)
    const events: string[] = [];

    let releaseR1: () => void = () => undefined;
    const r1 = withMaintenanceRead(async () => {
      events.push("r1-start");
      await new Promise<void>((resolve) => {
        releaseR1 = resolve;
      });
      events.push("r1-end");
    });
    await new Promise((r) => setImmediate(r));

    // Backup queues behind r1 (writer waits for in-flight readers to drain).
    const backupPromise = captureConsoleLog(() => runDailyBackup());
    await new Promise((r) => setImmediate(r));

    // r2 arrives AFTER backup is queued. Reader-preference would let r2
    // join r1 as a parallel reader — writer-preference forces r2 to wait.
    const r2 = withMaintenanceRead(async () => {
      events.push("r2-start");
    });

    // Yield several times — if writer-preference is broken, r2 would run
    // here while r1 still holds. With writer-preference, r2 stays queued
    // until r1 releases AND backup completes.
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setImmediate(r));
    }
    expect(events).toEqual(["r1-start"]);

    releaseR1();
    await Promise.all([r1, backupPromise, r2]);

    // Both reader bodies eventually ran — proves the lock did not deadlock.
    expect(events).toContain("r1-end");
    expect(events).toContain("r2-start");
  });
});

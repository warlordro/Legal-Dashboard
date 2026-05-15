import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import Database from "better-sqlite3";
import {
  deleteAllBackups,
  getBackupDir,
  listBackupsWithMeta,
  restoreFromBackup,
  runDailyBackup,
  withMaintenanceRead,
} from "./backup.ts";
import { closeDb } from "./schema.ts";

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

  it("does not leave a half-written tmp file alongside the live DB on success", async () => {
    const backupName = "legal-dashboard.2026-04-15.db";
    await seedBackup(backupName, "RESTORED");

    await restoreFromBackup(backupName);

    expect(fs.existsSync(dbPath + ".restore.tmp")).toBe(false);
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

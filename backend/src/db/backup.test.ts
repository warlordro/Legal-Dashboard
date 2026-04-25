import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "path";
import os from "os";
import fs from "fs";
import fsPromises from "fs/promises";
import Database from "better-sqlite3";
import { restoreFromBackup, getBackupDir } from "./backup.ts";
import { closeDb } from "./schema.ts";

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
    await expect(restoreFromBackup("legal-dashboard.does-not-exist.db")).rejects.toThrow(
      /inexistent/i,
    );
  });
});

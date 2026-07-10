// Task 7 (fixuri post-review): VACUUM INTO ruleaza intr-un worker thread —
// snapshot-urile self-service nu mai blocheaza event loop-ul principal
// (Codex H2 + panel H1). Runner-ul are timeout hard cu terminate() pe toate
// caile de esec si fallback sincron daca worker-ul nu porneste.

import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runSnapshotOp } from "./snapshotRunner.ts";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-snapworker-"));
});

afterEach(async () => {
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

function seedDb(p: string, rows: number): void {
  const db = new Database(p);
  try {
    db.pragma("journal_mode = WAL");
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, blob TEXT NOT NULL)");
    const insert = db.prepare("INSERT INTO t (blob) VALUES (?)");
    const insertMany = db.transaction((n: number) => {
      for (let i = 0; i < n; i++) insert.run(`rand-${i}-${"x".repeat(200)}`);
    });
    insertMany(rows);
  } finally {
    db.close();
  }
}

function countRows(p: string): number {
  const db = new Database(p, { readonly: true, fileMustExist: true });
  try {
    return (db.prepare("SELECT COUNT(*) AS n FROM t").get() as { n: number }).n;
  } finally {
    db.close();
  }
}

describe("runSnapshotOp — vacuum_into prin worker", () => {
  it("(a) snapshot-ul prin runner e identic functional cu varianta sincrona (count + integrity)", async () => {
    const src = path.join(tmpRoot, "src.db");
    const dest = path.join(tmpRoot, "dest.db");
    seedDb(src, 500);

    await runSnapshotOp({ op: "vacuum_into", srcPath: src, destPath: dest });

    expect(countRows(dest)).toBe(500);
    const probe = new Database(dest, { readonly: true, fileMustExist: true });
    try {
      const rows = probe.prepare("PRAGMA integrity_check").all() as { integrity_check: string }[];
      expect(rows.length).toBe(1);
      expect(rows[0]?.integrity_check).toBe("ok");
    } finally {
      probe.close();
    }
    // Snapshot self-contained, fara sidecars.
    expect(fs.existsSync(`${dest}-wal`)).toBe(false);
  });

  it("(c) fisier sursa lipsa => promise rejected, fara handle orfan (rm pe tmpdir merge)", async () => {
    const dest = path.join(tmpRoot, "dest.db");
    await expect(
      runSnapshotOp({ op: "vacuum_into", srcPath: path.join(tmpRoot, "nu-exista.db"), destPath: dest })
    ).rejects.toThrow();
    // Niciun handle orfan: directorul se poate sterge imediat (EBUSY altfel pe Windows).
    await fsPromises.rm(tmpRoot, { recursive: true, force: true });
    tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-snapworker-"));
  });

  it("(c) op invalid => promise rejected cu mesaj", async () => {
    const src = path.join(tmpRoot, "src.db");
    seedDb(src, 5);
    await expect(
      runSnapshotOp({ op: "bogus", srcPath: src, destPath: path.join(tmpRoot, "d.db") } as never)
    ).rejects.toThrow(/invalid|bogus/i);
  });

  it("(d) event loop-ul ramane responsiv in timpul unui VACUUM INTO mare", { timeout: 60_000 }, async () => {
    // ~40MB: destul cat VACUUM-ul sincron ar produce o gaura vizibila pe
    // thread-ul principal; prin worker, tick-urile raman sub 1s.
    const src = path.join(tmpRoot, "big.db");
    const db = new Database(src);
    try {
      db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, blob TEXT NOT NULL)");
      const insert = db.prepare("INSERT INTO t (blob) VALUES (?)");
      const chunk = "y".repeat(4000);
      const insertMany = db.transaction((n: number) => {
        for (let i = 0; i < n; i++) insert.run(chunk);
      });
      insertMany(10_000);
    } finally {
      db.close();
    }

    let maxGapMs = 0;
    let last = Date.now();
    const ticker = setInterval(() => {
      const now = Date.now();
      if (now - last > maxGapMs) maxGapMs = now - last;
      last = now;
    }, 25);
    try {
      await runSnapshotOp({ op: "vacuum_into", srcPath: src, destPath: path.join(tmpRoot, "big-copy.db") });
    } finally {
      clearInterval(ticker);
    }
    expect(maxGapMs).toBeLessThan(1000);
  });
});

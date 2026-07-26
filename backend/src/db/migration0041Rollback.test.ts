// CodeRabbit 1.1: un ciclu down->up pe migrarea 0041 dubla extra-ul fiecarui grant AI.
//
// down.sql face din 1 grant doua — insereaza o copie 'ai.multi' si redenumeste
// originalul 'ai.single' — iar up.sql le colapseaza pe amandoua inapoi in 'ai'.
// Extra-ul se aduna per grant, deci ambele se numara: un ciclu = x2, N cicluri = x2^N.
//
// Fixul sta in down.sql: nu se mai creeaza copia. up.sql NU se atinge — runner-ul
// trateaza fisierele .up.sql ca imuabile dupa aplicare (hash in _schema_versions), deci
// editarea lui ar fi rupt boot-ul pe instalarile existente. Fisierele .down.sql nu sunt
// hash-uite. Doua variante anterioare au fost respinse la review: marker prin prefix in
// `reason` (text liber — ar fi sters granturi legitime) si dedup in up (imuabilitate).
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MIGRATIONS_DIR } from "./schema.ts";

let db: Database.Database;

function readMigration(name: string): string {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, name), "utf8");
}

function totalAiExtra(): number {
  const row = db
    .prepare("SELECT COALESCE(SUM(extra_usd_milli), 0) AS total FROM user_quota_grants WHERE feature = 'ai'")
    .get() as { total: number };
  return row.total;
}

beforeEach(() => {
  db = new Database(":memory:");
  // Schema minima: doar tabela atinsa de migrarea 0041. Rularea intregului lant de
  // migrari ar lega testul de tot istoricul si l-ar face fragil la orice migrare noua.
  db.exec(`
    CREATE TABLE user_quota_grants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      feature TEXT NOT NULL,
      extra_usd_milli INTEGER NOT NULL,
      expires_at TEXT,
      reason TEXT,
      granted_by TEXT,
      granted_at TEXT,
      revoked_at TEXT,
      revoked_by TEXT,
      revoked_reason TEXT
    );
    CREATE TABLE user_quota_overrides (
      user_id TEXT NOT NULL,
      feature TEXT NOT NULL,
      period TEXT NOT NULL,
      limit_usd_milli INTEGER,
      updated_at INTEGER NOT NULL DEFAULT 0,
      updated_by TEXT,
      PRIMARY KEY (user_id, feature)
    );
    CREATE TABLE budget_notifications (feature TEXT NOT NULL);
    CREATE TABLE _schema_versions (version INTEGER PRIMARY KEY, sha256_up TEXT NOT NULL DEFAULT 'x');
  `);
  db.prepare(
    `INSERT INTO user_quota_grants (user_id, feature, extra_usd_milli, reason, granted_by, granted_at)
     VALUES ('alice', 'ai', 5000, 'buget suplimentar', 'admin1', '2026-07-01T10:00:00Z')`
  ).run();
});

afterEach(() => {
  db.close();
});

describe("migrarea 0041 — ciclu rollback (CodeRabbit 1.1)", () => {
  it("un ciclu down->up pastreaza extra-ul neschimbat", () => {
    expect(totalAiExtra()).toBe(5000);

    db.exec(readMigration("0041_unified_ai_quota.down.sql"));
    // Dupa down: UN singur rand, 'ai.single'. Inainte de fix erau doua ('ai.single' +
    // o copie 'ai.multi' indistinctibila), iar up-ul le aduna.
    expect(db.prepare("SELECT COUNT(*) AS n FROM user_quota_grants").get()).toEqual({ n: 1 });

    db.exec(readMigration("0041_unified_ai_quota.up.sql"));
    expect(totalAiExtra()).toBe(5000);
  });

  it("al DOILEA ciclu nu compune dublarea (fara fix ar fi x4)", () => {
    for (let i = 0; i < 2; i++) {
      db.exec(readMigration("0041_unified_ai_quota.down.sql"));
      db.exec(readMigration("0041_unified_ai_quota.up.sql"));
    }
    expect(totalAiExtra()).toBe(5000);
  });

  it("granturi genuin distincte ale aceluiasi user NU se pierd", () => {
    // Dedup-ul grupeaza pe toate coloanele; doua granturi care difera prin ORICE
    // camp (aici: suma si momentul) trebuie sa supravietuiasca amandoua.
    db.prepare(
      `INSERT INTO user_quota_grants (user_id, feature, extra_usd_milli, reason, granted_by, granted_at)
       VALUES ('alice', 'ai', 3000, 'al doilea buget', 'admin1', '2026-07-02T10:00:00Z')`
    ).run();
    expect(totalAiExtra()).toBe(8000);

    db.exec(readMigration("0041_unified_ai_quota.down.sql"));
    db.exec(readMigration("0041_unified_ai_quota.up.sql"));

    expect(totalAiExtra()).toBe(8000);
    expect(db.prepare("SELECT COUNT(*) AS n FROM user_quota_grants").get()).toEqual({ n: 2 });
  });
});

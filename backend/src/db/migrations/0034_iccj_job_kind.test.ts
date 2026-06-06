import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Minimal pre-0034 monitoring schema: monitoring_jobs (OLD 3-kind CHECK) as a
// PARENT, plus a CASCADE child (monitoring_alerts) and name_lists (referenced by
// name_list_id). The point of these tests is to prove the parent-table rebuild
// preserves child rows — i.e. legacy_alter_table=ON prevents the RENAME from
// rewriting child FKs and CASCADE-deleting them when _old is dropped.
// Mirror the runner's handling of `-- migrate:foreign_keys=off` migrations:
// toggle FK OFF around the transaction (it's a no-op inside one) + fk check.
function applyMarked(db: Database.Database, sql: string): void {
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      db.exec(sql);
      const violations = db.pragma("foreign_key_check") as unknown[];
      if (Array.isArray(violations) && violations.length > 0) {
        throw new Error(`FK violations: ${JSON.stringify(violations)}`);
      }
    })();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

function setupPre34(db: Database.Database): void {
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE name_lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      monitoring_job_id INTEGER
    );
    CREATE TABLE monitoring_jobs (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id           TEXT NOT NULL,
      kind               TEXT NOT NULL CHECK(kind IN ('dosar_soap','name_soap','aviz_rnpm')),
      target_json        TEXT NOT NULL,
      target_hash        TEXT NOT NULL,
      cadence_sec        INTEGER NOT NULL DEFAULT 14400 CHECK(cadence_sec BETWEEN 600 AND 86400),
      active             INTEGER NOT NULL DEFAULT 1,
      paused_until       TEXT,
      alert_config_json  TEXT NOT NULL DEFAULT '{}',
      next_run_at        TEXT NOT NULL,
      last_run_at        TEXT,
      last_status        TEXT CHECK(last_status IN ('ok','error','partial','skipped')),
      fail_streak        INTEGER NOT NULL DEFAULT 0,
      notes              TEXT,
      client_request_id  TEXT,
      created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      name_list_id       INTEGER REFERENCES name_lists(id) ON DELETE RESTRICT,
      UNIQUE(owner_id, target_hash, kind)
    );
    CREATE INDEX idx_monitoring_due ON monitoring_jobs(next_run_at) WHERE active = 1;
    CREATE INDEX idx_monitoring_owner ON monitoring_jobs(owner_id, kind);
    CREATE UNIQUE INDEX idx_monitoring_client_req
      ON monitoring_jobs(owner_id, client_request_id) WHERE client_request_id IS NOT NULL;
    CREATE INDEX idx_mj_name_list ON monitoring_jobs(name_list_id) WHERE name_list_id IS NOT NULL;
    CREATE TABLE monitoring_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES monitoring_jobs(id) ON DELETE CASCADE,
      title TEXT NOT NULL
    );
  `);
  db.prepare("INSERT INTO name_lists (id) VALUES (1)").run();
  db.prepare(
    `INSERT INTO monitoring_jobs (id, owner_id, kind, target_json, target_hash, next_run_at, name_list_id)
     VALUES (7, 'local', 'dosar_soap', '{"numar_dosar":"1/2/2024"}', 'h1', '2026-01-01T00:00:00Z', 1)`
  ).run();
  db.prepare("INSERT INTO monitoring_alerts (id, job_id, title) VALUES (100, 7, 'alerta')").run();
}

describe("migration 0034_iccj_job_kind", () => {
  let db: Database.Database;
  const up = readFileSync(resolve(__dirname, "0034_iccj_job_kind.up.sql"), "utf8");
  const down = readFileSync(resolve(__dirname, "0034_iccj_job_kind.down.sql"), "utf8");

  beforeEach(() => {
    db = new Database(":memory:");
    setupPre34(db);
  });
  afterEach(() => db.close());

  it("preserves parent job rows AND child alert rows (no CASCADE wipe)", () => {
    applyMarked(db, up);
    const job = db.prepare("SELECT owner_id, kind, name_list_id FROM monitoring_jobs WHERE id = 7").get() as
      | { owner_id: string; kind: string; name_list_id: number }
      | undefined;
    expect(job).toEqual({ owner_id: "local", kind: "dosar_soap", name_list_id: 1 });
    // The critical assertion: the child alert survived the parent rebuild.
    const alertCount = (db.prepare("SELECT COUNT(*) AS n FROM monitoring_alerts").get() as { n: number }).n;
    expect(alertCount).toBe(1);
  });

  it("accepts kind='iccj' after the migration", () => {
    applyMarked(db, up);
    expect(() =>
      db
        .prepare(
          `INSERT INTO monitoring_jobs (owner_id, kind, target_json, target_hash, next_run_at)
           VALUES ('local', 'iccj', '{"numar_dosar":"107/213/2017**"}', 'h2', '2026-01-01T00:00:00Z')`
        )
        .run()
    ).not.toThrow();
  });

  it("still rejects an unknown kind", () => {
    applyMarked(db, up);
    expect(() =>
      db
        .prepare(
          `INSERT INTO monitoring_jobs (owner_id, kind, target_json, target_hash, next_run_at)
           VALUES ('local', 'bogus', '{}', 'h3', '2026-01-01T00:00:00Z')`
        )
        .run()
    ).toThrow(/CHECK constraint/i);
  });

  it("keeps ON DELETE CASCADE wired after the rebuild", () => {
    applyMarked(db, up);
    db.prepare("DELETE FROM monitoring_jobs WHERE id = 7").run();
    const alertCount = (db.prepare("SELECT COUNT(*) AS n FROM monitoring_alerts").get() as { n: number }).n;
    expect(alertCount).toBe(0);
  });

  it("recreates all four monitoring_jobs indexes", () => {
    applyMarked(db, up);
    const idx = (db.prepare("PRAGMA index_list('monitoring_jobs')").all() as Array<{ name: string }>).map(
      (i) => i.name
    );
    for (const name of [
      "idx_monitoring_due",
      "idx_monitoring_owner",
      "idx_monitoring_client_req",
      "idx_mj_name_list",
    ]) {
      expect(idx).toContain(name);
    }
  });

  it("UP then DOWN reverts the CHECK (iccj rejected again)", () => {
    applyMarked(db, up);
    applyMarked(db, down);
    expect(() =>
      db
        .prepare(
          `INSERT INTO monitoring_jobs (owner_id, kind, target_json, target_hash, next_run_at)
           VALUES ('local', 'iccj', '{}', 'h4', '2026-01-01T00:00:00Z')`
        )
        .run()
    ).toThrow(/CHECK constraint/i);
    // Pre-existing rows still present after the round-trip.
    expect((db.prepare("SELECT COUNT(*) AS n FROM monitoring_jobs").get() as { n: number }).n).toBe(1);
  });

  it("F10: DOWN fails loud (and rolls back) when an iccj job exists", () => {
    applyMarked(db, up);
    db.prepare(
      `INSERT INTO monitoring_jobs (id, owner_id, kind, target_json, target_hash, next_run_at)
       VALUES (8, 'local', 'iccj', '{"numar_dosar":"1/1/2025"}', 'h-iccj', '2026-01-01T00:00:00Z')`
    ).run();
    // The down copy into the restored 3-kind CHECK table must reject the iccj row.
    expect(() => applyMarked(db, down)).toThrow(/CHECK constraint/i);
    // Transaction rolled back: the iccj row (and the post-up CHECK) survive intact.
    const iccj = db.prepare("SELECT COUNT(*) AS n FROM monitoring_jobs WHERE kind='iccj'").get() as { n: number };
    expect(iccj.n).toBe(1);
  });
});

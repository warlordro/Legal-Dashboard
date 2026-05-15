// Tests for monitoring_alerts repository.
//
// Contract:
//   - insertAlert is idempotent on (job_id, dedup_key) — same key returns the
//     existing row, never duplicates it.
//   - insertAlert refuses to write when (jobId, ownerId) do not belong together
//     (tenant-isolation guard against attaching alerts onto another tenant's
//     job, since UNIQUE(job_id, dedup_key) is NOT owner-scoped at the DB level).
//   - Readback after upsert is owner-scoped — even if a foreign-owner row
//     somehow exists for the same (job_id, dedup_key), insertAlert never
//     returns it.
//
// Both guards defend the file-header invariant ("Owner_id scoping is enforced
// on every query") that becomes load-bearing in PR-5/PR-6 (alerts UI) and
// PR-9 (web-mode multi-tenant). Migration 0005 will add a DB-level trigger as
// belt-and-suspenders; this test locks in the in-repo contract today.

import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addAlertEnrichmentListener,
  dismissAlert,
  enrichSolutieAlertsForJob,
  getAlertSubscriberCount,
  insertAlert,
  listAlerts,
  markAlertSeen,
  subscribeToNewAlerts,
  type AlertEnrichmentPayload,
} from "./monitoringAlertsRepository.ts";
import { closeDb, getDb } from "./schema.ts";

let tmpRoot: string;

const OWNER_A = "tenant-a";
const OWNER_B = "tenant-b";

function seedJob(ownerId: string, hashSeed: string): number {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO monitoring_jobs
         (owner_id, kind, target_json, target_hash, cadence_sec,
          alert_config_json, next_run_at)
       VALUES (?, 'dosar_soap', '{}', ?, 14400, '{}', '2026-04-28T12:00:00.000Z')`
    )
    .run(ownerId, hashSeed);
  return info.lastInsertRowid as number;
}

function seedRun(ownerId: string, jobId: number): number {
  const info = getDb()
    .prepare(
      `INSERT INTO monitoring_runs (owner_id, job_id, started_at, status)
       VALUES (?, ?, ?, 'running')`
    )
    .run(ownerId, jobId, "2026-04-28T10:00:00.000Z");
  return info.lastInsertRowid as number;
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-alerts-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
  const seed = new Database(process.env.LEGAL_DASHBOARD_DB_PATH);
  seed.close();
  getDb();
});

afterEach(async () => {
  closeDb();
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("insertAlert", () => {
  it("writes a row and returns it on the happy path", () => {
    const jobId = seedJob(OWNER_A, "h1");
    const runId = seedRun(OWNER_A, jobId);
    const { row, inserted } = insertAlert({
      ownerId: OWNER_A,
      jobId,
      runId,
      kind: "dosar_new",
      severity: "info",
      title: "Dosar nou",
      detail: { foo: "bar" },
      dedupKey: "k1",
    });
    expect(inserted).toBe(true);
    expect(row.id).toBeGreaterThan(0);
    expect(row.owner_id).toBe(OWNER_A);
    expect(row.job_id).toBe(jobId);
    expect(row.run_id).toBe(runId);
    expect(row.kind).toBe("dosar_new");
    expect(row.title).toBe("Dosar nou");
    expect(row.detail_json).toBe('{"foo":"bar"}');
    expect(row.dedup_key).toBe("k1");
  });

  it("is idempotent on (job_id, dedup_key) — second call returns the same row", () => {
    const jobId = seedJob(OWNER_A, "h1");
    const runId = seedRun(OWNER_A, jobId);
    const { row: first, inserted: firstInserted } = insertAlert({
      ownerId: OWNER_A,
      jobId,
      runId,
      kind: "dosar_new",
      title: "first",
      dedupKey: "same",
    });
    const { row: second, inserted: secondInserted } = insertAlert({
      ownerId: OWNER_A,
      jobId,
      runId,
      kind: "dosar_new",
      title: "second-ignored", // ON CONFLICT DO NOTHING, original wins
      dedupKey: "same",
    });
    expect(firstInserted).toBe(true);
    expect(secondInserted).toBe(false);
    expect(second.id).toBe(first.id);
    expect(second.title).toBe("first");

    const count = (getDb().prepare("SELECT COUNT(*) AS n FROM monitoring_alerts").get() as { n: number }).n;
    expect(count).toBe(1);
  });

  it("refuses to insert when (jobId, ownerId) belong to different tenants", () => {
    const jobIdA = seedJob(OWNER_A, "hA");
    const runIdA = seedRun(OWNER_A, jobIdA);
    expect(() =>
      insertAlert({
        ownerId: OWNER_B, // wrong owner for jobIdA
        jobId: jobIdA,
        runId: runIdA,
        kind: "dosar_new",
        title: "cross-tenant attempt",
        dedupKey: "k1",
      })
    ).toThrow(/not found for owner/);

    // Nothing was written.
    const count = (getDb().prepare("SELECT COUNT(*) AS n FROM monitoring_alerts").get() as { n: number }).n;
    expect(count).toBe(0);
  });

  it("refuses to insert when jobId does not exist at all", () => {
    expect(() =>
      insertAlert({
        ownerId: OWNER_A,
        jobId: 99999,
        runId: 1,
        kind: "dosar_new",
        title: "ghost job",
        dedupKey: "k1",
      })
    ).toThrow(/not found for owner/);
  });

  it("readback is owner-scoped: refuses to surface another tenant's row even if (job_id, dedup_key) collides", () => {
    // Set up jobs for two tenants and seed a foreign-owner row directly via
    // raw SQL. The pre-flight guard only validates (job, owner) pairing; the
    // readback owner-scoping is the second line of defense for the case where
    // a stale row exists with mismatched owner_id (e.g. legacy data, or a
    // future writer that bypasses the guard).
    const jobIdA = seedJob(OWNER_A, "hA");
    const runIdA = seedRun(OWNER_A, jobIdA);

    // Foreign row: owner_id=B but job_id=A's job. This violates the invariant
    // we want to protect — simulate it via raw SQL to exercise the readback.
    getDb()
      .prepare(
        `INSERT INTO monitoring_alerts
           (owner_id, job_id, run_id, kind, severity, title, detail_json, dedup_key)
         VALUES (?, ?, ?, 'dosar_new', 'info', 'foreign', '{}', 'collide')`
      )
      .run(OWNER_B, jobIdA, runIdA);

    // Now owner-A tries to insert with the same dedup_key. The INSERT
    // ON CONFLICT DO NOTHING is a no-op (foreign row blocks it), and the
    // owner-scoped readback finds nothing for owner-A, so we throw rather
    // than silently returning the foreign row.
    expect(() =>
      insertAlert({
        ownerId: OWNER_A,
        jobId: jobIdA,
        runId: runIdA,
        kind: "dosar_new",
        title: "owner-A attempt",
        dedupKey: "collide",
      })
    ).toThrow(/row missing after upsert/);
  });
});

describe("listAlerts", () => {
  it("paginates and filters by owner, job, kind, severity, new, and dismissed state", () => {
    const jobIdA1 = seedJob(OWNER_A, "hA1");
    const jobIdA2 = seedJob(OWNER_A, "hA2");
    const jobIdB = seedJob(OWNER_B, "hB");
    const runIdA1 = seedRun(OWNER_A, jobIdA1);
    const runIdA2 = seedRun(OWNER_A, jobIdA2);
    const runIdB = seedRun(OWNER_B, jobIdB);

    const { row: first } = insertAlert({
      ownerId: OWNER_A,
      jobId: jobIdA1,
      runId: runIdA1,
      kind: "dosar_new",
      severity: "info",
      title: "first",
      dedupKey: "a1",
    });
    const { row: second } = insertAlert({
      ownerId: OWNER_A,
      jobId: jobIdA2,
      runId: runIdA2,
      kind: "source_error",
      severity: "critical",
      title: "second",
      dedupKey: "a2",
    });
    insertAlert({
      ownerId: OWNER_B,
      jobId: jobIdB,
      runId: runIdB,
      kind: "source_error",
      severity: "critical",
      title: "foreign",
      dedupKey: "b1",
    });
    dismissAlert(OWNER_A, first.id);

    const pageOne = listAlerts({ ownerId: OWNER_A, page: 1, pageSize: 1 });
    expect(pageOne.total).toBe(1);
    expect(pageOne.rows).toHaveLength(1);
    expect(pageOne.rows[0].id).toBe(second.id);

    const withDismissed = listAlerts({
      ownerId: OWNER_A,
      page: 1,
      pageSize: 10,
      includeDismissed: true,
    });
    expect(withDismissed.total).toBe(2);

    const filtered = listAlerts({
      ownerId: OWNER_A,
      page: 1,
      pageSize: 10,
      jobId: jobIdA2,
      kind: "source_error",
      severity: "critical",
      isNew: true,
      dismissed: false,
    });
    expect(filtered.total).toBe(1);
    expect(filtered.rows[0].id).toBe(second.id);

    const dismissed = listAlerts({
      ownerId: OWNER_A,
      page: 1,
      pageSize: 10,
      dismissed: true,
    });
    expect(dismissed.rows.map((row) => row.id)).toEqual([first.id]);
  });
});

describe("alert state mutations", () => {
  it("marks alerts seen and dismissed with owner scoping", () => {
    const jobIdA = seedJob(OWNER_A, "hA");
    const jobIdB = seedJob(OWNER_B, "hB");
    const runIdA = seedRun(OWNER_A, jobIdA);
    const runIdB = seedRun(OWNER_B, jobIdB);
    const { row: alertA } = insertAlert({
      ownerId: OWNER_A,
      jobId: jobIdA,
      runId: runIdA,
      kind: "dosar_new",
      title: "owned",
      dedupKey: "a1",
    });
    const { row: alertB } = insertAlert({
      ownerId: OWNER_B,
      jobId: jobIdB,
      runId: runIdB,
      kind: "dosar_new",
      title: "foreign",
      dedupKey: "b1",
    });

    expect(markAlertSeen(OWNER_A, alertB.id)).toBeNull();
    const seen = markAlertSeen(OWNER_A, alertA.id);
    expect(seen?.is_new).toBe(0);
    expect(seen?.read_at).toBeTruthy();
    expect(seen?.dismissed_at).toBeNull();

    expect(dismissAlert(OWNER_A, alertB.id)).toBeNull();
    const dismissed = dismissAlert(OWNER_A, alertA.id);
    expect(dismissed?.is_new).toBe(0);
    expect(dismissed?.read_at).toBeTruthy();
    expect(dismissed?.dismissed_at).toBeTruthy();
  });
});

describe("new alert subscribers", () => {
  it("notifies only the matching owner and cleans up subscriptions", async () => {
    const jobIdA = seedJob(OWNER_A, "hA");
    const jobIdB = seedJob(OWNER_B, "hB");
    const runIdA = seedRun(OWNER_A, jobIdA);
    const runIdB = seedRun(OWNER_B, jobIdB);
    const seenA: number[] = [];
    const seenB: number[] = [];

    const unsubA = subscribeToNewAlerts(OWNER_A, (alert) => seenA.push(alert.id));
    const unsubB = subscribeToNewAlerts(OWNER_B, (alert) => seenB.push(alert.id));
    expect(getAlertSubscriberCount()).toBe(2);

    const { row: alertA } = insertAlert({
      ownerId: OWNER_A,
      jobId: jobIdA,
      runId: runIdA,
      kind: "dosar_new",
      title: "owned",
      dedupKey: "a1",
    });
    insertAlert({
      ownerId: OWNER_A,
      jobId: jobIdA,
      runId: runIdA,
      kind: "dosar_new",
      title: "duplicate",
      dedupKey: "a1",
    });
    const { row: alertB } = insertAlert({
      ownerId: OWNER_B,
      jobId: jobIdB,
      runId: runIdB,
      kind: "dosar_new",
      title: "foreign",
      dedupKey: "b1",
    });

    // notifyNewAlert is now deferred via queueMicrotask so listeners run
    // outside the SQLite write lock — drain the microtask queue before asserting.
    await Promise.resolve();

    expect(seenA).toEqual([alertA.id]);
    expect(seenB).toEqual([alertB.id]);

    unsubA();
    unsubB();
    expect(getAlertSubscriberCount()).toBe(0);
  });

  it("isolates listener exceptions: a throwing listener does not break siblings or insertAlert", async () => {
    const jobIdA = seedJob(OWNER_A, "hA");
    const runIdA = seedRun(OWNER_A, jobIdA);
    const seenSecond: number[] = [];

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const unsubFirst = subscribeToNewAlerts(OWNER_A, () => {
      throw new Error("boom");
    });
    const unsubSecond = subscribeToNewAlerts(OWNER_A, (alert) => {
      seenSecond.push(alert.id);
    });

    let inserted: ReturnType<typeof insertAlert> | undefined;
    expect(() => {
      inserted = insertAlert({
        ownerId: OWNER_A,
        jobId: jobIdA,
        runId: runIdA,
        kind: "dosar_new",
        title: "isolated",
        dedupKey: "iso",
      });
    }).not.toThrow();

    expect(inserted?.row.id).toBeGreaterThan(0);

    // notifyNewAlert is queueMicrotask-deferred — drain before checking.
    await Promise.resolve();

    expect(seenSecond).toEqual([inserted?.row.id]);
    expect(errSpy).toHaveBeenCalled();

    errSpy.mockRestore();
    unsubFirst();
    unsubSecond();
  });
});

// F8 — backfill / enrichment of solutie_aparuta alerts when PortalJust
// publishes the ruling text *after* the initial alert was emitted. The
// runner calls enrichSolutieAlertsForJob on every dosar_soap tick; these
// tests lock in the contract before more callers depend on it.
describe("enrichSolutieAlertsForJob", () => {
  function seedSolutieAlert(
    ownerId: string,
    jobId: number,
    runId: number,
    detail: Record<string, unknown>,
    dedupKey = `solutie-${crypto.randomUUID()}`
  ): number {
    const { row } = insertAlert({
      ownerId,
      jobId,
      runId,
      kind: "solutie_aparuta",
      title: "Solutie pronuntata",
      detail,
      dedupKey,
    });
    return row.id;
  }

  it("patches solutie_sumar / numar_document / data_pronuntare on a matching alert", () => {
    const jobId = seedJob(OWNER_A, "h1");
    const runId = seedRun(OWNER_A, jobId);
    const alertId = seedSolutieAlert(OWNER_A, jobId, runId, {
      data: "2026-04-01",
      ora: "10:00",
      complet: "C1",
      solutie: "Admite",
    });

    const patched = enrichSolutieAlertsForJob(OWNER_A, jobId, [
      {
        data: "2026-04-01",
        ora: "10:00",
        complet: "C1",
        solutie: "Admite",
        solutieSumar: "Admite cererea reclamantului.",
        numarDocument: "DOC/123",
        dataPronuntare: "2026-04-02",
      },
    ]);

    expect(patched).toBe(1);
    const detailJson = (
      getDb().prepare("SELECT detail_json FROM monitoring_alerts WHERE id = ?").get(alertId) as { detail_json: string }
    ).detail_json;
    const detail = JSON.parse(detailJson);
    expect(detail.solutie_sumar).toBe("Admite cererea reclamantului.");
    expect(detail.numar_document).toBe("DOC/123");
    expect(detail.data_pronuntare).toBe("2026-04-02");
  });

  it("is idempotent — second call with the same data is a no-op", () => {
    const jobId = seedJob(OWNER_A, "h1");
    const runId = seedRun(OWNER_A, jobId);
    seedSolutieAlert(OWNER_A, jobId, runId, {
      data: "2026-04-01",
      ora: "10:00",
      complet: "C1",
      solutie: "Admite",
    });

    const sedinte = [
      {
        data: "2026-04-01",
        ora: "10:00",
        complet: "C1",
        solutie: "Admite",
        solutieSumar: "Admite cererea.",
      },
    ];

    expect(enrichSolutieAlertsForJob(OWNER_A, jobId, sedinte)).toBe(1);
    expect(enrichSolutieAlertsForJob(OWNER_A, jobId, sedinte)).toBe(0);
  });

  it("never crosses tenant boundaries — owner B's alerts are not patched", () => {
    const jobIdA = seedJob(OWNER_A, "hA");
    const jobIdB = seedJob(OWNER_B, "hB");
    const runIdA = seedRun(OWNER_A, jobIdA);
    const runIdB = seedRun(OWNER_B, jobIdB);

    const aId = seedSolutieAlert(OWNER_A, jobIdA, runIdA, {
      data: "2026-04-01",
      ora: "10:00",
      complet: "C1",
      solutie: "Admite",
    });
    const bId = seedSolutieAlert(OWNER_B, jobIdB, runIdB, {
      data: "2026-04-01",
      ora: "10:00",
      complet: "C1",
      solutie: "Admite",
    });

    // Owner A enriches with sedinta data; owner B's matching alert must NOT
    // be touched even though the (data, ora, complet, solutie) tuple matches.
    const patched = enrichSolutieAlertsForJob(OWNER_A, jobIdA, [
      {
        data: "2026-04-01",
        ora: "10:00",
        complet: "C1",
        solutie: "Admite",
        solutieSumar: "Owner A only",
      },
    ]);
    expect(patched).toBe(1);

    const detailA = JSON.parse(
      (getDb().prepare("SELECT detail_json FROM monitoring_alerts WHERE id = ?").get(aId) as { detail_json: string })
        .detail_json
    );
    const detailB = JSON.parse(
      (getDb().prepare("SELECT detail_json FROM monitoring_alerts WHERE id = ?").get(bId) as { detail_json: string })
        .detail_json
    );
    expect(detailA.solutie_sumar).toBe("Owner A only");
    expect(detailB.solutie_sumar).toBeUndefined();
  });

  it("falls back to (data, ora, complet) match when the solutie text diverges (whitespace/typo)", () => {
    const jobId = seedJob(OWNER_A, "h1");
    const runId = seedRun(OWNER_A, jobId);
    const alertId = seedSolutieAlert(OWNER_A, jobId, runId, {
      data: "2026-04-01",
      ora: "10:00",
      complet: "C1",
      solutie: "Admite cererea",
    });

    // PortalJust republishes with slightly different text.
    const patched = enrichSolutieAlertsForJob(OWNER_A, jobId, [
      {
        data: "2026-04-01",
        ora: "10:00",
        complet: "C1",
        solutie: "Admite cererea formulata", // diverged
        solutieSumar: "Hotarare definitiva.",
      },
    ]);
    expect(patched).toBe(1);
    const detail = JSON.parse(
      (
        getDb().prepare("SELECT detail_json FROM monitoring_alerts WHERE id = ?").get(alertId) as {
          detail_json: string;
        }
      ).detail_json
    );
    expect(detail.solutie_sumar).toBe("Hotarare definitiva.");
  });

  it("skips alerts older than 7 days so historical context isn't overwritten after fond->apel transitions", () => {
    const jobId = seedJob(OWNER_A, "h1");
    const runId = seedRun(OWNER_A, jobId);
    const alertId = seedSolutieAlert(OWNER_A, jobId, runId, {
      data: "2025-12-01",
      ora: "10:00",
      complet: "C1",
      solutie: "Respinge",
    });

    // Manually backdate the alert past the 7-day window.
    getDb().prepare(`UPDATE monitoring_alerts SET created_at = datetime('now', '-30 days') WHERE id = ?`).run(alertId);

    const patched = enrichSolutieAlertsForJob(
      OWNER_A,
      jobId,
      [
        {
          data: "2025-12-01",
          ora: "10:00",
          complet: "C1",
          solutie: "Respinge",
          solutieSumar: "Should not patch.",
        },
      ],
      { instanta: "Curtea de Apel SUCEAVA", stadiu: "Apel" }
    );
    expect(patched).toBe(0);
    const detail = JSON.parse(
      (
        getDb().prepare("SELECT detail_json FROM monitoring_alerts WHERE id = ?").get(alertId) as {
          detail_json: string;
        }
      ).detail_json
    );
    expect(detail.solutie_sumar).toBeUndefined();
    expect(detail.instanta).toBeUndefined();
    expect(detail.stadiu).toBeUndefined();
  });

  it("skips rows with corrupt detail_json without aborting the batch", () => {
    const jobId = seedJob(OWNER_A, "h1");
    const runId = seedRun(OWNER_A, jobId);
    const goodId = seedSolutieAlert(OWNER_A, jobId, runId, {
      data: "2026-04-01",
      ora: "10:00",
      complet: "C1",
      solutie: "Admite",
    });
    const corruptId = seedSolutieAlert(
      OWNER_A,
      jobId,
      runId,
      { data: "2026-04-02", ora: "11:00", complet: "C2", solutie: "Respinge" },
      "corrupt"
    );
    // Corrupt the detail_json on one row directly.
    getDb().prepare(`UPDATE monitoring_alerts SET detail_json = '{not json' WHERE id = ?`).run(corruptId);

    const patched = enrichSolutieAlertsForJob(OWNER_A, jobId, [
      {
        data: "2026-04-01",
        ora: "10:00",
        complet: "C1",
        solutie: "Admite",
        solutieSumar: "OK",
      },
      {
        data: "2026-04-02",
        ora: "11:00",
        complet: "C2",
        solutie: "Respinge",
        solutieSumar: "Should be skipped — corrupt JSON",
      },
    ]);
    expect(patched).toBe(1);
    const goodDetail = JSON.parse(
      (getDb().prepare("SELECT detail_json FROM monitoring_alerts WHERE id = ?").get(goodId) as { detail_json: string })
        .detail_json
    );
    expect(goodDetail.solutie_sumar).toBe("OK");
  });

  it("backfills dosar-level instanta/stadiu independently of sedinta matches", () => {
    const jobId = seedJob(OWNER_A, "h1");
    const runId = seedRun(OWNER_A, jobId);
    const alertId = seedSolutieAlert(OWNER_A, jobId, runId, {
      data: "2026-04-01",
      ora: "10:00",
      complet: "C1",
      solutie: "Admite",
    });

    // No sedinta candidates — only dosar context.
    const patched = enrichSolutieAlertsForJob(OWNER_A, jobId, [], {
      instanta: "Curtea de Apel SUCEAVA",
      stadiu: "Apel",
    });
    expect(patched).toBe(1);
    const detail = JSON.parse(
      (
        getDb().prepare("SELECT detail_json FROM monitoring_alerts WHERE id = ?").get(alertId) as {
          detail_json: string;
        }
      ).detail_json
    );
    expect(detail.instanta).toBe("Curtea de Apel SUCEAVA");
    expect(detail.stadiu).toBe("Apel");
  });

  it("returns 0 quickly when there are no candidates and no dosar context (cheap no-op)", () => {
    const jobId = seedJob(OWNER_A, "h1");
    const runId = seedRun(OWNER_A, jobId);
    seedSolutieAlert(OWNER_A, jobId, runId, {
      data: "2026-04-01",
      ora: "10:00",
      complet: "C1",
      solutie: "Admite",
    });

    expect(
      enrichSolutieAlertsForJob(OWNER_A, jobId, [
        {
          // sedinta with no enrichable fields filtered out internally
          data: "2026-04-01",
          ora: "10:00",
          complet: "C1",
          solutie: "Admite",
        },
      ])
    ).toBe(0);
  });

  it("emits an alert_enriched listener payload after commit (deferred via microtask)", async () => {
    const jobId = seedJob(OWNER_A, "h1");
    const runId = seedRun(OWNER_A, jobId);
    const alertId = seedSolutieAlert(OWNER_A, jobId, runId, {
      data: "2026-04-01",
      ora: "10:00",
      complet: "C1",
      solutie: "Admite",
    });

    const heard: AlertEnrichmentPayload[] = [];
    const unsub = addAlertEnrichmentListener(OWNER_A, (payload) => {
      heard.push(payload);
    });

    enrichSolutieAlertsForJob(OWNER_A, jobId, [
      {
        data: "2026-04-01",
        ora: "10:00",
        complet: "C1",
        solutie: "Admite",
        solutieSumar: "Hotarare.",
      },
    ]);

    // notifyAlertEnriched is queueMicrotask-deferred — drain before asserting.
    await Promise.resolve();
    expect(heard).toHaveLength(1);
    expect(heard[0].id).toBe(alertId);
    expect(heard[0].ownerId).toBe(OWNER_A);
    expect(heard[0].detail.solutie_sumar).toBe("Hotarare.");
    unsub();
  });

  it("scopes enrichment listeners per-owner (B does not hear A's events)", async () => {
    const jobIdA = seedJob(OWNER_A, "hA");
    const jobIdB = seedJob(OWNER_B, "hB");
    const runIdA = seedRun(OWNER_A, jobIdA);
    const runIdB = seedRun(OWNER_B, jobIdB);
    seedSolutieAlert(OWNER_A, jobIdA, runIdA, {
      data: "2026-04-01",
      ora: "10:00",
      complet: "C1",
      solutie: "Admite",
    });
    seedSolutieAlert(OWNER_B, jobIdB, runIdB, {
      data: "2026-04-01",
      ora: "10:00",
      complet: "C1",
      solutie: "Admite",
    });

    const heardA: AlertEnrichmentPayload[] = [];
    const heardB: AlertEnrichmentPayload[] = [];
    const unsubA = addAlertEnrichmentListener(OWNER_A, (p) => heardA.push(p));
    const unsubB = addAlertEnrichmentListener(OWNER_B, (p) => heardB.push(p));

    enrichSolutieAlertsForJob(OWNER_A, jobIdA, [
      {
        data: "2026-04-01",
        ora: "10:00",
        complet: "C1",
        solutie: "Admite",
        solutieSumar: "A only",
      },
    ]);

    await Promise.resolve();
    expect(heardA).toHaveLength(1);
    expect(heardB).toHaveLength(0);

    unsubA();
    unsubB();
  });
});

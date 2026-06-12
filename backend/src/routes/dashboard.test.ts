// Integration tests for /api/v1/dashboard/{summary,timeline,charts}
// (PR-A v2.7.0 + PR-B v2.8.0).
//
// Coverage (summary):
//   - envelope shape: { data: { jobs, alerts, runs, ai, generatedAt }, requestId }
//   - empty state: zero rows -> all blocks zeroed but well-formed
//   - owner isolation: rows for another owner do not leak into the summary
//   - jobs block: byKind breakdown counts only active=1, ignores other kinds
//   - alerts block: unseen excludes read/dismissed; last24h windowed by created_at
//   - runs block: ok/error/timeout/aborted buckets, only
//     terminal rows (ended_at IS NOT NULL) are counted
//   - performance: runs aggregation uses idx_runs_owner_ended
//   - ai block: 24h totals (calls + tokens + costUsd derived from milli)
//
// Coverage (timeline, PR-B):
//   - envelope shape, empty state
//   - merged DESC stream of alerts + runs + curated audit
//   - cursor pagination (nextCursor + ts < cursor)
//   - audit curation: only listed actions OR outcome != 'ok' surface
//   - owner isolation across all three sources
//
// Coverage (charts, PR-B):
//   - envelope shape; range=7d default; range=30d
//   - daily series backfill (zero-fill missing days)
//   - runs daily pivot (ok/error/timeout/aborted columns per day)
//   - AI daily costUsd derived from cost_usd_milli/1000
//   - invalid range -> 400 with envelope error code

import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../db/schema.ts";
import { insertAlert } from "../db/monitoringAlertsRepository.ts";
import { insertRunning, finalize } from "../db/monitoringRunsRepository.ts";
import { insertAiUsage } from "../db/aiUsageRepository.ts";
import { recordAudit } from "../db/auditRepository.ts";
import { requestIdContext } from "../middleware/requestId.ts";
import { dashboardRouter } from "./dashboard.ts";

let tmpRoot: string;
let dbPath: string;

function buildTestApp() {
  const app = new Hono();
  app.use("*", async (c, next) => {
    const fakeOwner = c.req.header("x-test-owner") ?? "local";
    c.set("ownerId", fakeOwner);
    await next();
  });
  app.use("*", requestIdContext);
  app.route("/api/v1/dashboard", dashboardRouter);
  return app;
}

function seedJob(opts: {
  ownerId: string;
  kind: "dosar_soap" | "name_soap" | "aviz_rnpm";
  active?: number;
  hashSuffix?: string;
}): number {
  const db = getDb();
  // better-sqlite3 returns lastInsertRowid as number | bigint. We don't enable
  // safeIntegers, so it's number in practice — but Number(...) makes the
  // narrowing explicit and avoids the `as number` cast over a bigint type.
  const rowId = db
    .prepare(
      `INSERT INTO monitoring_jobs
         (owner_id, kind, target_json, target_hash, cadence_sec,
          alert_config_json, next_run_at, active)
       VALUES (?, ?, '{}', ?, 14400, '{}', ?, ?)`
    )
    .run(
      opts.ownerId,
      opts.kind,
      `hash-${opts.ownerId}-${opts.kind}-${opts.hashSuffix ?? Math.random()}`,
      new Date().toISOString(),
      opts.active ?? 1
    ).lastInsertRowid;
  return Number(rowId);
}

function seedFinalizedRun(opts: {
  ownerId: string;
  jobId: number;
  status: "ok" | "error" | "timeout" | "aborted";
  endedAt?: string;
}): number {
  const startedAt = new Date(Date.now() - 1000).toISOString();
  const runId = insertRunning({ ownerId: opts.ownerId, jobId: opts.jobId, startedAt });
  finalize(runId, {
    status: opts.status,
    endedAt: opts.endedAt ?? new Date().toISOString(),
    durationMs: 500,
  });
  return runId;
}

interface SummaryResponse {
  data: {
    jobs: { active: number; byKind: { dosar_soap: number; name_soap: number } };
    alerts: { unseen: number; last24h: number };
    runs: { ok: number; error: number; timeout: number; aborted: number; total: number };
    ai: { costUsd: number; calls: number; tokens: number };
    generatedAt: string;
  };
  requestId: string;
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-dashboard-routes-"));
  dbPath = path.join(tmpRoot, "legal-dashboard.db");
  process.env.LEGAL_DASHBOARD_DB_PATH = dbPath;
  const seed = new Database(dbPath);
  seed.close();
  getDb();
});

afterEach(async () => {
  closeDb();
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("GET /api/v1/dashboard/summary", () => {
  it("returns the v1 envelope with all blocks well-formed in empty state", async () => {
    const app = buildTestApp();
    const res = await app.request("/api/v1/dashboard/summary", {
      headers: { "x-test-owner": "alice", "x-request-id": "req-empty-1" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SummaryResponse;
    expect(body.requestId).toBe("req-empty-1");
    expect(body.data.jobs).toEqual({ active: 0, byKind: { dosar_soap: 0, name_soap: 0 } });
    expect(body.data.alerts).toEqual({ unseen: 0, last24h: 0 });
    expect(body.data.runs).toEqual({ ok: 0, error: 0, timeout: 0, aborted: 0, total: 0 });
    expect(body.data.ai).toEqual({ costUsd: 0, calls: 0, tokens: 0 });
    expect(typeof body.data.generatedAt).toBe("string");
  });

  it("counts only active jobs and breaks down by kind", async () => {
    seedJob({ ownerId: "alice", kind: "dosar_soap", hashSuffix: "1" });
    seedJob({ ownerId: "alice", kind: "dosar_soap", hashSuffix: "2" });
    seedJob({ ownerId: "alice", kind: "name_soap", hashSuffix: "3" });
    seedJob({ ownerId: "alice", kind: "aviz_rnpm", hashSuffix: "4" });
    // Inactive — must not contribute to active count.
    seedJob({ ownerId: "alice", kind: "dosar_soap", hashSuffix: "5", active: 0 });

    const app = buildTestApp();
    const res = await app.request("/api/v1/dashboard/summary", {
      headers: { "x-test-owner": "alice" },
    });
    const body = (await res.json()) as SummaryResponse;
    expect(body.data.jobs.active).toBe(4);
    expect(body.data.jobs.byKind.dosar_soap).toBe(2);
    expect(body.data.jobs.byKind.name_soap).toBe(1);
  });

  it("alerts.unseen excludes read/dismissed alerts; last24h respects window", async () => {
    const jobId = seedJob({ ownerId: "alice", kind: "dosar_soap", hashSuffix: "alerts" });
    const runId = seedFinalizedRun({ ownerId: "alice", jobId, status: "ok" });

    insertAlert({
      ownerId: "alice",
      jobId,
      runId,
      kind: "termen_new",
      title: "Alert 1 — fresh, unseen",
      detail: { foo: "bar" },
      dedupKey: "k-fresh-unseen",
    });
    const insertedRead = insertAlert({
      ownerId: "alice",
      jobId,
      runId,
      kind: "termen_new",
      title: "Alert 2 — fresh but read",
      detail: { foo: "bar" },
      dedupKey: "k-fresh-read",
    });
    // Backdate read flag: sets read_at so countUnreadAlerts excludes it.
    getDb()
      .prepare("UPDATE monitoring_alerts SET read_at = ? WHERE id = ?")
      .run(new Date().toISOString(), insertedRead.row.id);

    // Old alert (older than 24h): created_at backdated to 2 days ago.
    const oldRow = insertAlert({
      ownerId: "alice",
      jobId,
      runId,
      kind: "termen_new",
      title: "Alert 3 — old",
      detail: { foo: "bar" },
      dedupKey: "k-old",
    });
    const oldCreated = new Date(Date.now() - 2 * 86_400_000).toISOString();
    getDb().prepare("UPDATE monitoring_alerts SET created_at = ? WHERE id = ?").run(oldCreated, oldRow.row.id);

    const app = buildTestApp();
    const res = await app.request("/api/v1/dashboard/summary", {
      headers: { "x-test-owner": "alice" },
    });
    const body = (await res.json()) as SummaryResponse;
    // Unseen: alert 1 + alert 3 (alert 2 is read). Old age does NOT remove it.
    expect(body.data.alerts.unseen).toBe(2);
    // Last24h: alert 1 + alert 2 (alert 3 backdated outside window).
    expect(body.data.alerts.last24h).toBe(2);
  });

  it("runs block buckets aborted separately from error", async () => {
    const jobId = seedJob({ ownerId: "alice", kind: "dosar_soap", hashSuffix: "runs" });
    seedFinalizedRun({ ownerId: "alice", jobId, status: "ok" });
    seedFinalizedRun({ ownerId: "alice", jobId, status: "ok" });
    seedFinalizedRun({ ownerId: "alice", jobId, status: "error" });
    seedFinalizedRun({ ownerId: "alice", jobId, status: "timeout" });
    seedFinalizedRun({ ownerId: "alice", jobId, status: "aborted" });

    const app = buildTestApp();
    const res = await app.request("/api/v1/dashboard/summary", {
      headers: { "x-test-owner": "alice" },
    });
    const body = (await res.json()) as SummaryResponse;
    expect(body.data.runs.total).toBe(5);
    expect(body.data.runs.ok).toBe(2);
    expect(body.data.runs.timeout).toBe(1);
    expect(body.data.runs.error).toBe(1);
    expect(body.data.runs.aborted).toBe(1);
  });

  it("uses idx_runs_owner_ended for finalized runs aggregation", () => {
    const explain = getDb()
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT status, COUNT(*) AS n
         FROM monitoring_runs
         WHERE owner_id = ?
           AND ended_at IS NOT NULL
           AND ended_at >= ?
         GROUP BY status`
      )
      .all("alice", "2026-05-01T00:00:00.000Z") as Array<{ detail: string }>;

    expect(explain.some((row) => row.detail.includes("idx_runs_owner_ended"))).toBe(true);
  });

  it("excludes still-running rows from runs aggregation (only ended_at IS NOT NULL)", async () => {
    // Two jobs because the partial index idx_one_running_per_job allows only
    // one `running` row per job_id at a time.
    const stuckJobId = seedJob({ ownerId: "alice", kind: "dosar_soap", hashSuffix: "stuck" });
    const okJobId = seedJob({ ownerId: "alice", kind: "name_soap", hashSuffix: "ok" });
    // Stuck-running row — must not contribute to total.
    insertRunning({ ownerId: "alice", jobId: stuckJobId, startedAt: new Date().toISOString() });
    seedFinalizedRun({ ownerId: "alice", jobId: okJobId, status: "ok" });

    const app = buildTestApp();
    const res = await app.request("/api/v1/dashboard/summary", {
      headers: { "x-test-owner": "alice" },
    });
    const body = (await res.json()) as SummaryResponse;
    expect(body.data.runs.total).toBe(1);
    expect(body.data.runs.ok).toBe(1);
  });

  it("ai block aggregates 24h totals (calls + tokens + costUsd from milli)", async () => {
    insertAiUsage({
      ownerId: "alice",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      feature: "dosar_summary",
      inputTokens: 100,
      outputTokens: 50,
      costUsdMilli: 1_500, // = 1.5 USD
    });
    insertAiUsage({
      ownerId: "alice",
      provider: "openai",
      model: "gpt-5.4-mini",
      feature: "dosar_summary",
      inputTokens: 200,
      outputTokens: 100,
      costUsdMilli: 500, // = 0.5 USD
    });

    const app = buildTestApp();
    const res = await app.request("/api/v1/dashboard/summary", {
      headers: { "x-test-owner": "alice" },
    });
    const body = (await res.json()) as SummaryResponse;
    expect(body.data.ai.calls).toBe(2);
    expect(body.data.ai.tokens).toBe(450);
    expect(body.data.ai.costUsd).toBeCloseTo(2.0, 3);
  });

  it("does not leak another owner's data into the summary", async () => {
    // alice has nothing
    // bob has a lot
    const bobJob = seedJob({ ownerId: "bob", kind: "dosar_soap", hashSuffix: "iso" });
    seedFinalizedRun({ ownerId: "bob", jobId: bobJob, status: "ok" });
    const bobRun = seedFinalizedRun({ ownerId: "bob", jobId: bobJob, status: "error" });
    insertAlert({
      ownerId: "bob",
      jobId: bobJob,
      runId: bobRun,
      kind: "termen_new",
      title: "Bob's alert — must not appear",
      detail: { foo: "bar" },
      dedupKey: "bob-key",
    });
    insertAiUsage({
      ownerId: "bob",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      feature: "dosar_summary",
      inputTokens: 9999,
      outputTokens: 9999,
      costUsdMilli: 999_999,
    });

    const app = buildTestApp();
    const aliceRes = await app.request("/api/v1/dashboard/summary", {
      headers: { "x-test-owner": "alice" },
    });
    const body = (await aliceRes.json()) as SummaryResponse;
    expect(body.data.jobs.active).toBe(0);
    expect(body.data.runs.total).toBe(0);
    expect(body.data.alerts.unseen).toBe(0);
    expect(body.data.alerts.last24h).toBe(0);
    expect(body.data.ai.calls).toBe(0);
    expect(body.data.ai.costUsd).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// PR-B v2.8.0 — /api/v1/dashboard/timeline
// ────────────────────────────────────────────────────────────────────────────

interface TimelineEvent {
  id: string;
  ts: string;
  kind: "alert" | "run" | "audit";
  severity: "info" | "warning" | "critical";
  title: string;
  detail: Record<string, unknown>;
}

interface TimelineResponse {
  data: {
    events: TimelineEvent[];
    nextCursor: string | null;
    generatedAt: string;
  };
  requestId: string;
}

function backdateAlert(alertId: number, ts: string): void {
  getDb().prepare("UPDATE monitoring_alerts SET created_at = ? WHERE id = ?").run(ts, alertId);
}

function backdateRun(runId: number, endedAt: string): void {
  getDb().prepare("UPDATE monitoring_runs SET ended_at = ? WHERE id = ?").run(endedAt, runId);
}

function backdateAudit(auditId: number, ts: string): void {
  getDb().prepare("UPDATE audit_log SET ts = ? WHERE id = ?").run(ts, auditId);
}

function lastAuditId(): number {
  return (getDb().prepare("SELECT MAX(id) AS id FROM audit_log").get() as { id: number }).id;
}

describe("GET /api/v1/dashboard/timeline", () => {
  it("returns the v1 envelope with empty events on a fresh DB", async () => {
    const app = buildTestApp();
    const res = await app.request("/api/v1/dashboard/timeline?limit=10", {
      headers: { "x-test-owner": "alice", "x-request-id": "req-tl-empty" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as TimelineResponse;
    expect(body.requestId).toBe("req-tl-empty");
    expect(body.data.events).toEqual([]);
    expect(body.data.nextCursor).toBeNull();
    expect(typeof body.data.generatedAt).toBe("string");
  });

  it("merges alerts + runs + curated audit into one DESC stream", async () => {
    const jobId = seedJob({ ownerId: "alice", kind: "dosar_soap", hashSuffix: "tl" });
    const runId = seedFinalizedRun({ ownerId: "alice", jobId, status: "ok" });
    backdateRun(runId, "2026-04-30T10:00:00.000Z");
    const a = insertAlert({
      ownerId: "alice",
      jobId,
      runId,
      kind: "termen_new",
      title: "Alert older",
      detail: { x: 1 },
      dedupKey: "tl-a",
    });
    backdateAlert(a.row.id, "2026-04-30T11:00:00.000Z");
    const b = insertAlert({
      ownerId: "alice",
      jobId,
      runId,
      kind: "solutie_aparuta",
      title: "Alert newer",
      detail: { x: 2 },
      dedupKey: "tl-b",
    });
    backdateAlert(b.row.id, "2026-04-30T13:00:00.000Z");
    recordAudit(null, "monitoring.job.deleted", {
      ownerId: "alice",
      detail: { reason: "user click" },
    });
    backdateAudit(lastAuditId(), "2026-04-30T12:00:00.000Z");

    const app = buildTestApp();
    const res = await app.request("/api/v1/dashboard/timeline?limit=10", {
      headers: { "x-test-owner": "alice" },
    });
    const body = (await res.json()) as TimelineResponse;
    expect(body.data.events).toHaveLength(4);
    // DESC by ts: alert b (13:00) > audit (12:00) > alert a (11:00) > run (10:00)
    expect(body.data.events.map((e) => e.kind)).toEqual(["alert", "audit", "alert", "run"]);
    expect(body.data.nextCursor).toBeNull();
  });

  it("paginates via cursor (events strictly older than the cursor)", async () => {
    const jobId = seedJob({ ownerId: "alice", kind: "dosar_soap", hashSuffix: "page" });
    // Single shared run, backdated older than all alerts so the timeline
    // doesn't intermix it with the alert pages we're asserting on.
    const sharedRun = seedFinalizedRun({ ownerId: "alice", jobId, status: "ok" });
    backdateRun(sharedRun, "2026-04-20T00:00:00.000Z");
    // Seed 5 alerts at 1h intervals (newest first when ORDER BY DESC).
    for (let i = 0; i < 5; i++) {
      const r = insertAlert({
        ownerId: "alice",
        jobId,
        runId: sharedRun,
        kind: "termen_new",
        title: `Alert ${i}`,
        detail: { i },
        dedupKey: `tl-page-${i}`,
      });
      // Backdate so each is 1h older than the previous.
      backdateAlert(r.row.id, `2026-04-25T${10 + i}:00:00.000Z`);
    }

    const app = buildTestApp();
    // First page: 2 events. Newest = i=4 (14:00), then i=3 (13:00).
    const page1Res = await app.request("/api/v1/dashboard/timeline?limit=2", {
      headers: { "x-test-owner": "alice" },
    });
    const page1 = (await page1Res.json()) as TimelineResponse;
    expect(page1.data.events).toHaveLength(2);
    expect(page1.data.events[0].title).toBe("Alert 4");
    expect(page1.data.events[1].title).toBe("Alert 3");
    // Composite cursor: `<ts>|<eventId>` so page boundaries with shared ts
    // resolve deterministically via the (ts, id) tie-breaker.
    expect(page1.data.nextCursor).toMatch(/^2026-04-25T13:00:00\.000Z\|alert:\d+$/);

    // Second page: cursor = nextCursor → returns events strictly older.
    const page2Res = await app.request(
      `/api/v1/dashboard/timeline?limit=2&cursor=${encodeURIComponent(page1.data.nextCursor!)}`,
      { headers: { "x-test-owner": "alice" } }
    );
    const page2 = (await page2Res.json()) as TimelineResponse;
    // First event on page 2 is Alert 2 (12:00).
    const titles2 = page2.data.events.map((e) => e.title);
    expect(titles2[0]).toBe("Alert 2");
    expect(titles2[1]).toBe("Alert 1");
  });

  it("compound cursor disambiguates events sharing the boundary ts across sources", async () => {
    // Seed alert + finalized run + curated audit row at the EXACT same ts so
    // the page-1/page-2 boundary lands on three events sharing the same
    // millisecond. Without a compound (ts, id) cursor, two of them disappear.
    const sharedTs = "2026-04-25T12:00:00.000Z";
    const jobId = seedJob({ ownerId: "alice", kind: "dosar_soap", hashSuffix: "boundary" });
    const runId = seedFinalizedRun({ ownerId: "alice", jobId, status: "ok" });
    backdateRun(runId, sharedTs);
    const alert = insertAlert({
      ownerId: "alice",
      jobId,
      runId,
      kind: "termen_new",
      title: "Boundary alert",
      detail: {},
      dedupKey: "tl-boundary-1",
    });
    backdateAlert(alert.row.id, sharedTs);
    recordAudit(null, "monitoring.job.deleted", { ownerId: "alice" });
    backdateAudit(lastAuditId(), sharedTs);

    const app = buildTestApp();
    // Page size 1 so the first page returns the lex-largest event id at the
    // shared ts and the cursor must use the tie-breaker to skip past it.
    const page1Res = await app.request("/api/v1/dashboard/timeline?limit=1", {
      headers: { "x-test-owner": "alice" },
    });
    const page1 = (await page1Res.json()) as TimelineResponse;
    expect(page1.data.events).toHaveLength(1);
    expect(page1.data.nextCursor).not.toBeNull();
    expect(page1.data.nextCursor).toMatch(/^2026-04-25T12:00:00\.000Z\|/);

    const page2Res = await app.request(
      `/api/v1/dashboard/timeline?limit=1&cursor=${encodeURIComponent(page1.data.nextCursor!)}`,
      { headers: { "x-test-owner": "alice" } }
    );
    const page2 = (await page2Res.json()) as TimelineResponse;
    expect(page2.data.events).toHaveLength(1);
    // The page-2 event must be a different one from page-1, even though both
    // share the boundary ts. With a ts-only cursor this assertion would fail
    // because page-2 would either repeat page-1 or skip directly past the ts.
    expect(page2.data.events[0].id).not.toBe(page1.data.events[0].id);

    // Third page: completes the trio.
    const page3Res = await app.request(
      `/api/v1/dashboard/timeline?limit=1&cursor=${encodeURIComponent(page2.data.nextCursor!)}`,
      { headers: { "x-test-owner": "alice" } }
    );
    const page3 = (await page3Res.json()) as TimelineResponse;
    expect(page3.data.events).toHaveLength(1);
    const seenIds = new Set([page1.data.events[0].id, page2.data.events[0].id, page3.data.events[0].id]);
    expect(seenIds.size).toBe(3); // all three boundary events surfaced exactly once
  });

  it("audit curation: surfaces curated actions; ignores chatty actions; surfaces non-ok outcomes", async () => {
    // Seed three audit rows for alice:
    //   - "alert_seen" with outcome=ok → NOT in curated list, should be filtered out
    //   - "monitoring.job.deleted" → curated
    //   - "alert_seen" with outcome=denied → NOT curated but outcome != ok, surfaces
    recordAudit(null, "alert_seen", { ownerId: "alice", outcome: "ok" });
    backdateAudit(lastAuditId(), "2026-04-25T10:00:00.000Z");
    recordAudit(null, "monitoring.job.deleted", { ownerId: "alice" });
    backdateAudit(lastAuditId(), "2026-04-25T11:00:00.000Z");
    recordAudit(null, "alert_seen", { ownerId: "alice", outcome: "denied" });
    backdateAudit(lastAuditId(), "2026-04-25T12:00:00.000Z");

    const app = buildTestApp();
    const res = await app.request("/api/v1/dashboard/timeline?limit=10", {
      headers: { "x-test-owner": "alice" },
    });
    const body = (await res.json()) as TimelineResponse;
    const titles = body.data.events.map((e) => e.title);
    expect(titles).toContain("monitoring.job.deleted");
    expect(titles).toContain("alert_seen"); // the denied one
    // The first "alert_seen" (ok outcome, not curated) must not surface.
    // Both alert_seen rows share the same title; we asserted exactly one denied
    // surfaced by counting events:
    const auditEvents = body.data.events.filter((e) => e.kind === "audit");
    expect(auditEvents).toHaveLength(2);
  });

  it("does not leak another owner's events into the timeline", async () => {
    const bobJob = seedJob({ ownerId: "bob", kind: "dosar_soap", hashSuffix: "leak" });
    const bobRun = seedFinalizedRun({ ownerId: "bob", jobId: bobJob, status: "error" });
    insertAlert({
      ownerId: "bob",
      jobId: bobJob,
      runId: bobRun,
      kind: "termen_new",
      title: "Bob's alert — must not appear",
      detail: {},
      dedupKey: "bob-tl",
    });
    recordAudit(null, "monitoring.job.deleted", { ownerId: "bob" });

    const app = buildTestApp();
    const res = await app.request("/api/v1/dashboard/timeline?limit=10", {
      headers: { "x-test-owner": "alice" },
    });
    const body = (await res.json()) as TimelineResponse;
    expect(body.data.events).toEqual([]);
    expect(body.data.nextCursor).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// PR-B v2.8.0 — /api/v1/dashboard/charts
// ────────────────────────────────────────────────────────────────────────────

interface ChartsResponse {
  data: {
    range: "7d" | "30d";
    since: string;
    until: string;
    series: {
      alerts: { day: string; count: number }[];
      runs: { day: string; ok: number; error: number; timeout: number; aborted: number; total: number }[];
      aiCost: { day: string; costUsd: number; calls: number; tokens: number }[];
    };
    generatedAt: string;
  };
  requestId: string;
}

describe("GET /api/v1/dashboard/charts", () => {
  it("default range is 7d; backfills empty days with zeroes", async () => {
    const app = buildTestApp();
    const res = await app.request("/api/v1/dashboard/charts", {
      headers: { "x-test-owner": "alice", "x-request-id": "req-charts-default" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ChartsResponse;
    expect(body.requestId).toBe("req-charts-default");
    expect(body.data.range).toBe("7d");
    expect(body.data.series.alerts).toHaveLength(7);
    expect(body.data.series.runs).toHaveLength(7);
    expect(body.data.series.aiCost).toHaveLength(7);
    // All days zero on a fresh DB.
    for (const p of body.data.series.alerts) expect(p.count).toBe(0);
    for (const p of body.data.series.runs) expect(p.total).toBe(0);
    for (const p of body.data.series.aiCost) expect(p.costUsd).toBe(0);
  });

  it("range=30d returns 30 days for each series", async () => {
    const app = buildTestApp();
    const res = await app.request("/api/v1/dashboard/charts?range=30d", {
      headers: { "x-test-owner": "alice" },
    });
    const body = (await res.json()) as ChartsResponse;
    expect(body.data.range).toBe("30d");
    expect(body.data.series.alerts).toHaveLength(30);
    expect(body.data.series.runs).toHaveLength(30);
    expect(body.data.series.aiCost).toHaveLength(30);
  });

  it("invalid range returns 400 with envelope error code", async () => {
    const app = buildTestApp();
    const res = await app.request("/api/v1/dashboard/charts?range=99d", {
      headers: { "x-test-owner": "alice" },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string }; data: null };
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("invalid_range");
  });

  it("aggregates runs by day and pivots into ok/error/timeout/aborted columns", async () => {
    const jobId = seedJob({ ownerId: "alice", kind: "dosar_soap", hashSuffix: "charts" });
    // Two runs today: 1 ok, 1 error. SQLite will bucket both into today's row.
    seedFinalizedRun({ ownerId: "alice", jobId, status: "ok" });
    seedFinalizedRun({ ownerId: "alice", jobId, status: "error" });

    const app = buildTestApp();
    const res = await app.request("/api/v1/dashboard/charts?range=7d", {
      headers: { "x-test-owner": "alice" },
    });
    const body = (await res.json()) as ChartsResponse;
    // Today is the LAST point in the grid (since = 6 days ago, ordered ASC).
    const today = body.data.series.runs[6];
    expect(today.total).toBe(2);
    expect(today.ok).toBe(1);
    expect(today.error).toBe(1);
    expect(today.timeout).toBe(0);
    expect(today.aborted).toBe(0);
  });

  it("AI cost daily series converts cost_usd_milli/1000 to USD", async () => {
    insertAiUsage({
      ownerId: "alice",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      feature: "dosar_summary",
      inputTokens: 100,
      outputTokens: 50,
      costUsdMilli: 2_500, // 2.5 USD
    });

    const app = buildTestApp();
    const res = await app.request("/api/v1/dashboard/charts?range=7d", {
      headers: { "x-test-owner": "alice" },
    });
    const body = (await res.json()) as ChartsResponse;
    const today = body.data.series.aiCost[6];
    expect(today.costUsd).toBeCloseTo(2.5, 3);
    expect(today.calls).toBe(1);
    expect(today.tokens).toBe(150);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// PR-C v2.9.0 — /report endpoint tests
// ──────────────────────────────────────────────────────────────────────────

interface ReportResponse {
  data: {
    range: "7d" | "30d";
    since: string;
    until: string;
    summary: SummaryResponse["data"];
    charts: ChartsResponse["data"];
    timeline: {
      events: Array<{ id: string; ts: string; kind: string; severity: string; title: string }>;
      truncated: boolean;
      limitPerSource: number;
    };
    generatedAt: string;
  };
  requestId: string;
}

describe("GET /api/v1/dashboard/report", () => {
  it("returns the v1 envelope with summary + charts + timeline blocks well-formed in empty state", async () => {
    const app = buildTestApp();
    const res = await app.request("/api/v1/dashboard/report?range=7d", {
      headers: { "x-test-owner": "alice", "x-request-id": "req-report-empty" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReportResponse;
    expect(body.requestId).toBe("req-report-empty");
    expect(body.data.range).toBe("7d");
    expect(body.data.summary.jobs).toEqual({ active: 0, byKind: { dosar_soap: 0, name_soap: 0 } });
    expect(body.data.charts.series.alerts).toHaveLength(7);
    expect(body.data.charts.series.runs).toHaveLength(7);
    expect(body.data.charts.series.aiCost).toHaveLength(7);
    expect(body.data.timeline.events).toEqual([]);
    expect(body.data.timeline.truncated).toBe(false);
    expect(body.data.timeline.limitPerSource).toBeGreaterThan(0);
    expect(typeof body.data.generatedAt).toBe("string");
  });

  it("invalid range returns 400 with envelope error code", async () => {
    const app = buildTestApp();
    const res = await app.request("/api/v1/dashboard/report?range=42d", {
      headers: { "x-test-owner": "alice" },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string }; data: null };
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("invalid_range");
  });

  it("range=30d expands grid to 30 days", async () => {
    const app = buildTestApp();
    const res = await app.request("/api/v1/dashboard/report?range=30d", {
      headers: { "x-test-owner": "alice" },
    });
    const body = (await res.json()) as ReportResponse;
    expect(body.data.range).toBe("30d");
    expect(body.data.charts.series.alerts).toHaveLength(30);
    expect(body.data.charts.series.runs).toHaveLength(30);
    expect(body.data.charts.series.aiCost).toHaveLength(30);
  });

  it("timeline merges alerts + finalized runs + curated audit in DESC order", async () => {
    const jobId = seedJob({ ownerId: "alice", kind: "dosar_soap", hashSuffix: "report-timeline" });
    const runId = seedFinalizedRun({ ownerId: "alice", jobId, status: "ok" });
    insertAlert({
      ownerId: "alice",
      jobId,
      runId,
      kind: "termen_new",
      title: "Termen nou pentru dosar X",
      detail: { foo: "bar" },
      dedupKey: "k-report-1",
    });
    recordAudit(null, "auth.denied", {
      ownerId: "alice",
      targetKind: "session",
      outcome: "denied",
      detail: { reason: "missing_token" },
    });

    // v2.37.1 (CI flake, Build Windows @ v2.37.1): randurile de mai sus primesc
    // timestamp "now" din ceasuri diferite (JS Date in recordAudit, strftime
    // SQLite in insert/finalize), iar handler-ul captureaza `until = new Date()`
    // cateva ms mai tarziu. Pe runnerele Windows un pas de ceas (NTP) intre
    // insert si request poate lasa un rand DUPA `until`, scotandu-l din fereastra
    // [since, until]. Decuplam testul de ceasul de perete: backdatam explicit
    // toate cele 3 randuri la un instant fix din interiorul ferestrei de 7 zile.
    const backdatedTs = new Date(Date.now() - 3_600_000).toISOString();
    const db = getDb();
    db.prepare("UPDATE monitoring_alerts SET created_at = ? WHERE owner_id = 'alice'").run(backdatedTs);
    db.prepare("UPDATE monitoring_runs SET started_at = ?, ended_at = ? WHERE owner_id = 'alice'").run(
      backdatedTs,
      backdatedTs
    );
    db.prepare("UPDATE audit_log SET ts = ? WHERE owner_id = 'alice'").run(backdatedTs);

    const app = buildTestApp();
    const res = await app.request("/api/v1/dashboard/report?range=7d", {
      headers: { "x-test-owner": "alice" },
    });
    const body = (await res.json()) as ReportResponse;
    // 1 alert + 1 finalized run + 1 audit = 3 events.
    expect(body.data.timeline.events).toHaveLength(3);
    const kinds = body.data.timeline.events.map((e) => e.kind);
    expect(kinds).toContain("alert");
    expect(kinds).toContain("run");
    expect(kinds).toContain("audit");
    // DESC ordering: each ts is >= the next.
    for (let i = 1; i < body.data.timeline.events.length; i++) {
      expect(body.data.timeline.events[i - 1].ts >= body.data.timeline.events[i].ts).toBe(true);
    }
  });

  it("owner isolation: events from other owners are excluded from timeline + charts", async () => {
    const aliceJob = seedJob({ ownerId: "alice", kind: "dosar_soap", hashSuffix: "iso-alice" });
    const aliceRun = seedFinalizedRun({ ownerId: "alice", jobId: aliceJob, status: "ok" });
    insertAlert({
      ownerId: "alice",
      jobId: aliceJob,
      runId: aliceRun,
      kind: "termen_new",
      title: "Alice alert",
      detail: {},
      dedupKey: "k-iso-alice",
    });

    const bobJob = seedJob({ ownerId: "bob", kind: "dosar_soap", hashSuffix: "iso-bob" });
    const bobRun = seedFinalizedRun({ ownerId: "bob", jobId: bobJob, status: "error" });
    insertAlert({
      ownerId: "bob",
      jobId: bobJob,
      runId: bobRun,
      kind: "termen_new",
      title: "Bob alert",
      detail: {},
      dedupKey: "k-iso-bob",
    });

    const app = buildTestApp();
    const res = await app.request("/api/v1/dashboard/report?range=7d", {
      headers: { "x-test-owner": "alice" },
    });
    const body = (await res.json()) as ReportResponse;
    const titles = body.data.timeline.events.map((e) => e.title);
    expect(titles).toContain("Alice alert");
    expect(titles).not.toContain("Bob alert");
    // Charts: alice's day = 1 alert + 1 ok run; bob's data must not bleed in.
    const todayAlerts = body.data.charts.series.alerts[6];
    expect(todayAlerts.count).toBe(1);
    const todayRuns = body.data.charts.series.runs[6];
    expect(todayRuns.ok).toBe(1);
    expect(todayRuns.error).toBe(0);
  });
});

// Integration tests for /api/v1/dashboard/summary (PR-A v2.7.0).
//
// Coverage:
//   - envelope shape: { data: { jobs, alerts, runs, ai, generatedAt }, requestId }
//   - empty state: zero rows -> all blocks zeroed but well-formed
//   - owner isolation: rows for another owner do not leak into the summary
//   - jobs block: byKind breakdown counts only active=1, ignores other kinds
//   - alerts block: unseen excludes read/dismissed; last24h windowed by created_at
//   - runs block: ok/error/timeout buckets, aborted folded into error, only
//     terminal rows (ended_at IS NOT NULL) are counted
//   - ai block: 24h totals (calls + tokens + costUsd derived from milli)

import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fsPromises from "fs/promises";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../db/schema.ts";
import { insertAlert } from "../db/monitoringAlertsRepository.ts";
import { insertRunning, finalize } from "../db/monitoringRunsRepository.ts";
import { insertAiUsage } from "../db/aiUsageRepository.ts";
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
       VALUES (?, ?, '{}', ?, 14400, '{}', ?, ?)`,
    )
    .run(
      opts.ownerId,
      opts.kind,
      `hash-${opts.ownerId}-${opts.kind}-${opts.hashSuffix ?? Math.random()}`,
      new Date().toISOString(),
      opts.active ?? 1,
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
    runs: { ok: number; error: number; timeout: number; total: number };
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
    expect(body.data.runs).toEqual({ ok: 0, error: 0, timeout: 0, total: 0 });
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
      .prepare(`UPDATE monitoring_alerts SET read_at = ? WHERE id = ?`)
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
    getDb()
      .prepare(`UPDATE monitoring_alerts SET created_at = ? WHERE id = ?`)
      .run(oldCreated, oldRow.row.id);

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

  it("runs block buckets ok/error/timeout and folds aborted into error", async () => {
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
    // error includes aborted (1 explicit error + 1 aborted = 2).
    expect(body.data.runs.error).toBe(2);
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

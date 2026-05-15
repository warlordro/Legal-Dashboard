// Integration tests for /api/v1/alerts (PR-6 backend worker).

import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getAlertSubscriberCount, insertAlert, type MonitoringAlertRow } from "../db/monitoringAlertsRepository.ts";
import { closeDb, getDb } from "../db/schema.ts";
import { requestIdContext } from "../middleware/requestId.ts";
import { alertsRouter } from "./alerts.ts";

let tmpRoot: string;

const OWNER_A = "alice";
const OWNER_B = "bob";

interface AlertListResponse {
  data: { rows: MonitoringAlertRow[]; total: number; page: number; pageSize: number };
  requestId: string;
}

function buildTestApp() {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("ownerId", c.req.header("x-test-owner") ?? "local");
    await next();
  });
  app.use("*", requestIdContext);
  app.route("/api/v1/alerts", alertsRouter);
  return app;
}

function seedJob(
  ownerId: string,
  hashSeed: string,
  options: {
    kind?: "dosar_soap" | "name_soap" | "aviz_rnpm";
    target?: Record<string, unknown>;
  } = {}
): number {
  const kind = options.kind ?? "dosar_soap";
  const target = options.target ?? {};
  const info = getDb()
    .prepare(
      `INSERT INTO monitoring_jobs
         (owner_id, kind, target_json, target_hash, cadence_sec,
          alert_config_json, next_run_at)
       VALUES (?, ?, ?, ?, 14400, '{}', '2026-04-28T12:00:00.000Z')`
    )
    .run(ownerId, kind, JSON.stringify(target), hashSeed);
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

function seedAlert(ownerId: string, overrides: Partial<Parameters<typeof insertAlert>[0]> = {}): MonitoringAlertRow {
  const jobId = overrides.jobId ?? seedJob(ownerId, `${ownerId}-${crypto.randomUUID()}`);
  const runId = overrides.runId ?? seedRun(ownerId, jobId);
  return insertAlert({
    ownerId,
    jobId,
    runId,
    kind: "dosar_new",
    severity: "info",
    title: "Alerta",
    dedupKey: crypto.randomUUID(),
    ...overrides,
  }).row;
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-alert-routes-"));
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

describe("GET /api/v1/alerts", () => {
  it("returns owner-scoped paginated and filtered alerts", async () => {
    const app = buildTestApp();
    const first = seedAlert(OWNER_A, {
      kind: "dosar_new",
      severity: "info",
      title: "first",
      dedupKey: "a1",
    });
    const second = seedAlert(OWNER_A, {
      kind: "source_error",
      severity: "critical",
      title: "second",
      dedupKey: "a2",
    });
    seedAlert(OWNER_B, {
      kind: "source_error",
      severity: "critical",
      title: "foreign",
      dedupKey: "b1",
    });

    const page = await app.request("/api/v1/alerts?page=1&pageSize=1", {
      headers: { "x-test-owner": OWNER_A },
    });
    expect(page.status).toBe(200);
    const pageJson = (await page.json()) as {
      data: { rows: MonitoringAlertRow[]; total: number; page: number; pageSize: number };
      requestId: string;
    };
    expect(pageJson.requestId).toBeTruthy();
    expect(pageJson.data.total).toBe(2);
    expect(pageJson.data.rows).toHaveLength(1);
    expect(pageJson.data.rows[0].id).toBe(second.id);

    const filtered = await app.request(
      "/api/v1/alerts?kind=source_error&severity=critical&isNew=true&dismissed=false",
      { headers: { "x-test-owner": OWNER_A } }
    );
    expect(filtered.status).toBe(200);
    const filteredJson = (await filtered.json()) as {
      data: { rows: MonitoringAlertRow[]; total: number };
    };
    expect(filteredJson.data.total).toBe(1);
    expect(filteredJson.data.rows[0].id).toBe(second.id);
    expect(filteredJson.data.rows.map((row) => row.id)).not.toContain(first.id);

    const bob = await app.request("/api/v1/alerts", {
      headers: { "x-test-owner": OWNER_B },
    });
    const bobJson = (await bob.json()) as { data: { rows: MonitoringAlertRow[]; total: number } };
    expect(bobJson.data.total).toBe(1);
    expect(bobJson.data.rows[0].owner_id).toBe(OWNER_B);
  });

  it("rejects invalid query parameters", async () => {
    const app = buildTestApp();
    const res = await app.request("/api/v1/alerts?pageSize=999");
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("invalid_query");
  });

  // v2.16.1 — regression: pre-fix, the inline kind enum on GET / dropped
  // `termen_dupa_solutie` (added in v2.15.0), so any client filtering on the
  // composite kind got 400 even though the alert is in the DB. Once the route
  // consumes ALERT_KINDS, future kinds must keep this green.
  it("accepts kind=termen_dupa_solutie filter (v2.15.0 composite)", async () => {
    const app = buildTestApp();
    const composite = seedAlert(OWNER_A, {
      kind: "termen_dupa_solutie",
      title: "Termen dupa solutie",
      dedupKey: "tds-1",
    });
    seedAlert(OWNER_A, { kind: "termen_new", dedupKey: "tds-2" });

    const res = await app.request("/api/v1/alerts?kind=termen_dupa_solutie", {
      headers: { "x-test-owner": OWNER_A },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as AlertListResponse;
    expect(json.data.total).toBe(1);
    expect(json.data.rows[0].id).toBe(composite.id);
  });

  it("filters alerts by source job kind", async () => {
    const app = buildTestApp();
    const dosarJob = seedJob(OWNER_A, "dosar-kind", {
      kind: "dosar_soap",
      target: { numar_dosar: "1234/3/2024" },
    });
    const nameJob = seedJob(OWNER_A, "name-kind", {
      kind: "name_soap",
      target: { name_normalized: "STEFAN POPESCU" },
    });
    seedAlert(OWNER_A, { jobId: dosarJob, runId: seedRun(OWNER_A, dosarJob), title: "dosar" });
    seedAlert(OWNER_A, { jobId: nameJob, runId: seedRun(OWNER_A, nameJob), title: "name" });

    const res = await app.request("/api/v1/alerts?jobKind=dosar_soap", {
      headers: { "x-test-owner": OWNER_A },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as AlertListResponse;
    expect(json.data.total).toBe(1);
    expect(json.data.rows[0].job_kind).toBe("dosar_soap");
    expect(json.data.rows[0].title).toBe("dosar");
  });

  it("searches target numar_dosar diacritic-insensitive and keeps total in sync", async () => {
    const app = buildTestApp();
    const matchJob = seedJob(OWNER_A, "dosar-q-match", {
      kind: "dosar_soap",
      target: { numar_dosar: "1234/3/2024" },
    });
    const missJob = seedJob(OWNER_A, "dosar-q-miss", {
      kind: "dosar_soap",
      target: { numar_dosar: "9999/3/2024" },
    });
    seedAlert(OWNER_A, { jobId: matchJob, runId: seedRun(OWNER_A, matchJob), title: "match" });
    seedAlert(OWNER_A, { jobId: missJob, runId: seedRun(OWNER_A, missJob), title: "miss" });

    const res = await app.request("/api/v1/alerts?q=1234", {
      headers: { "x-test-owner": OWNER_A },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as AlertListResponse;
    expect(json.data.total).toBe(1);
    expect(json.data.rows).toHaveLength(1);
    expect(json.data.rows[0].title).toBe("match");
  });

  it("searches target name_normalized with and without diacritics", async () => {
    const app = buildTestApp();
    const stefanJob = seedJob(OWNER_A, "name-stefan", {
      kind: "name_soap",
      target: { name_normalized: "STEFAN POPESCU" },
    });
    const ionJob = seedJob(OWNER_A, "name-ion", {
      kind: "name_soap",
      target: { name_normalized: "ION POPESCU" },
    });
    seedAlert(OWNER_A, { jobId: stefanJob, runId: seedRun(OWNER_A, stefanJob), title: "stefan" });
    seedAlert(OWNER_A, { jobId: ionJob, runId: seedRun(OWNER_A, ionJob), title: "ion" });

    const plain = await app.request("/api/v1/alerts?q=stefan", {
      headers: { "x-test-owner": OWNER_A },
    });
    expect(plain.status).toBe(200);
    const plainJson = (await plain.json()) as AlertListResponse;
    expect(plainJson.data.total).toBe(1);
    expect(plainJson.data.rows[0].title).toBe("stefan");

    const accented = await app.request(`/api/v1/alerts?q=${encodeURIComponent("Ștefan")}`, {
      headers: { "x-test-owner": OWNER_A },
    });
    expect(accented.status).toBe(200);
    const accentedJson = (await accented.json()) as AlertListResponse;
    expect(accentedJson.data.total).toBe(1);
    expect(accentedJson.data.rows[0].title).toBe("stefan");
  });

  it("treats SQL wildcard characters in q as literals", async () => {
    const app = buildTestApp();
    const firstJob = seedJob(OWNER_A, "wild-first", {
      kind: "dosar_soap",
      target: { numar_dosar: "1234/3/2024" },
    });
    const secondJob = seedJob(OWNER_A, "wild-second", {
      kind: "name_soap",
      target: { name_normalized: "STEFAN POPESCU" },
    });
    seedAlert(OWNER_A, { jobId: firstJob, runId: seedRun(OWNER_A, firstJob), title: "first" });
    seedAlert(OWNER_A, { jobId: secondJob, runId: seedRun(OWNER_A, secondJob), title: "second" });

    const res = await app.request(`/api/v1/alerts?q=${encodeURIComponent("%")}`, {
      headers: { "x-test-owner": OWNER_A },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as AlertListResponse;
    expect(json.data.total).toBe(0);
    expect(json.data.rows).toHaveLength(0);
  });

  it("searches alert detail_json.numar_dosar (dosare discovered by name_soap)", async () => {
    const app = buildTestApp();
    const nameJob = seedJob(OWNER_A, "name-discover", {
      kind: "name_soap",
      target: { name_normalized: "ACME SRL" },
    });
    const runId = seedRun(OWNER_A, nameJob);
    seedAlert(OWNER_A, {
      jobId: nameJob,
      runId,
      title: "Dosar nou pentru ACME SRL",
      detail: { numar_dosar: "5014/SEED/2025", name_normalized: "ACME SRL" },
      dedupKey: "n1",
    });
    seedAlert(OWNER_A, {
      jobId: nameJob,
      runId,
      title: "Alt dosar",
      detail: { numar_dosar: "9999/X/2024", name_normalized: "ACME SRL" },
      dedupKey: "n2",
    });

    const res = await app.request("/api/v1/alerts?q=5014", {
      headers: { "x-test-owner": OWNER_A },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as AlertListResponse;
    expect(json.data.total).toBe(1);
    expect(json.data.rows[0].title).toBe("Dosar nou pentru ACME SRL");
  });

  it("searches alert title text (any token visible to user)", async () => {
    const app = buildTestApp();
    const job = seedJob(OWNER_A, "title-search", {
      kind: "dosar_soap",
      target: { numar_dosar: "1234/3/2024" },
    });
    const runId = seedRun(OWNER_A, job);
    seedAlert(OWNER_A, {
      jobId: job,
      runId,
      title: "Termen nou: Sala 5",
      dedupKey: "t1",
    });
    seedAlert(OWNER_A, {
      jobId: job,
      runId,
      title: "Solutie aparuta",
      dedupKey: "t2",
    });

    const res = await app.request("/api/v1/alerts?q=sala", {
      headers: { "x-test-owner": OWNER_A },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as AlertListResponse;
    expect(json.data.total).toBe(1);
    expect(json.data.rows[0].title).toBe("Termen nou: Sala 5");
  });

  it("ANDs q with jobKind", async () => {
    const app = buildTestApp();
    const dosarJob = seedJob(OWNER_A, "and-dosar", {
      kind: "dosar_soap",
      target: { numar_dosar: "1234/3/2024" },
    });
    const nameJob = seedJob(OWNER_A, "and-name", {
      kind: "name_soap",
      target: { name_normalized: "DOSAR 1234 TEST" },
    });
    seedAlert(OWNER_A, { jobId: dosarJob, runId: seedRun(OWNER_A, dosarJob), title: "dosar" });
    seedAlert(OWNER_A, { jobId: nameJob, runId: seedRun(OWNER_A, nameJob), title: "name" });

    const res = await app.request("/api/v1/alerts?q=1234&jobKind=name_soap", {
      headers: { "x-test-owner": OWNER_A },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as AlertListResponse;
    expect(json.data.total).toBe(1);
    expect(json.data.rows[0].title).toBe("name");
    expect(json.data.rows[0].job_kind).toBe("name_soap");
  });
});

describe("PATCH /api/v1/alerts/:id/seen and /dismissed", () => {
  it("marks owned alerts seen and dismissed", async () => {
    const app = buildTestApp();
    const alert = seedAlert(OWNER_A);

    const seen = await app.request(`/api/v1/alerts/${alert.id}/seen`, {
      method: "PATCH",
      headers: { "x-test-owner": OWNER_A },
    });
    expect(seen.status).toBe(200);
    const seenJson = (await seen.json()) as { data: MonitoringAlertRow };
    expect(seenJson.data.is_new).toBe(0);
    expect(seenJson.data.read_at).toBeTruthy();
    expect(seenJson.data.dismissed_at).toBeNull();

    const dismissed = await app.request(`/api/v1/alerts/${alert.id}/dismissed`, {
      method: "PATCH",
      headers: { "x-test-owner": OWNER_A },
    });
    expect(dismissed.status).toBe(200);
    const dismissedJson = (await dismissed.json()) as { data: MonitoringAlertRow };
    expect(dismissedJson.data.is_new).toBe(0);
    expect(dismissedJson.data.dismissed_at).toBeTruthy();
  });

  it("does not leak cross-owner alert existence", async () => {
    const app = buildTestApp();
    const alert = seedAlert(OWNER_A);

    const seen = await app.request(`/api/v1/alerts/${alert.id}/seen`, {
      method: "PATCH",
      headers: { "x-test-owner": OWNER_B },
    });
    expect(seen.status).toBe(404);

    const dismissed = await app.request(`/api/v1/alerts/${alert.id}/dismissed`, {
      method: "PATCH",
      headers: { "x-test-owner": OWNER_B },
    });
    expect(dismissed.status).toBe(404);
  });

  it("PATCH /:id/unseen toggles read_at back to null on owned alerts", async () => {
    const app = buildTestApp();
    const alert = seedAlert(OWNER_A);

    const seen = await app.request(`/api/v1/alerts/${alert.id}/seen`, {
      method: "PATCH",
      headers: { "x-test-owner": OWNER_A },
    });
    expect(seen.status).toBe(200);
    const seenJson = (await seen.json()) as { data: MonitoringAlertRow };
    expect(seenJson.data.read_at).toBeTruthy();

    const unseen = await app.request(`/api/v1/alerts/${alert.id}/unseen`, {
      method: "PATCH",
      headers: { "x-test-owner": OWNER_A },
    });
    expect(unseen.status).toBe(200);
    const unseenJson = (await unseen.json()) as { data: MonitoringAlertRow };
    expect(unseenJson.data.read_at).toBeNull();
    // is_new stays 0 — we already broadcast the SSE "new alert" event on insert,
    // toggling unread shouldn't re-fire it.
    expect(unseenJson.data.is_new).toBe(0);
  });

  it("PATCH /:id/unseen is idempotent on already-unread alerts", async () => {
    const app = buildTestApp();
    const alert = seedAlert(OWNER_A);

    const unseen = await app.request(`/api/v1/alerts/${alert.id}/unseen`, {
      method: "PATCH",
      headers: { "x-test-owner": OWNER_A },
    });
    expect(unseen.status).toBe(200);
    const json = (await unseen.json()) as { data: MonitoringAlertRow };
    expect(json.data.read_at).toBeNull();
  });

  it("PATCH /:id/unseen returns 404 for cross-owner ids", async () => {
    const app = buildTestApp();
    const alert = seedAlert(OWNER_A);

    const unseen = await app.request(`/api/v1/alerts/${alert.id}/unseen`, {
      method: "PATCH",
      headers: { "x-test-owner": OWNER_B },
    });
    expect(unseen.status).toBe(404);
  });
});

describe("GET /api/v1/alerts/stream", () => {
  it("streams newly inserted alerts for the requesting owner and cleans up on cancel", async () => {
    const app = buildTestApp();
    const res = await app.request("/api/v1/alerts/stream", {
      headers: { "x-test-owner": OWNER_A },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body?.getReader();
    expect(reader).toBeTruthy();
    const decoder = new TextDecoder();
    let buffer = "";

    const readUntil = async (needle: string): Promise<string> => {
      const started = Date.now();
      while (!buffer.includes(needle)) {
        if (Date.now() - started > 1000) {
          throw new Error(`Timed out waiting for ${needle}; buffer=${buffer}`);
        }
        const next = await reader!.read();
        if (next.done) break;
        buffer += decoder.decode(next.value, { stream: true });
      }
      return buffer;
    };

    await readUntil("event: ready");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getAlertSubscriberCount(OWNER_A)).toBe(1);

    seedAlert(OWNER_B, { title: "foreign", dedupKey: "foreign" });
    const owned = seedAlert(OWNER_A, { title: "owned", dedupKey: "owned" });

    const text = await readUntil(`id: ${owned.id}`);
    expect(text).toContain("event: alert");
    expect(text).toContain('"title":"owned"');
    expect(text).not.toContain('"title":"foreign"');

    await reader!.cancel();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getAlertSubscriberCount(OWNER_A)).toBe(0);
  });
});

interface AlertExportRow {
  alert: MonitoringAlertRow;
  numarDosar: string | null;
  dosarLink: string | null;
  kindLabel: string;
  severityLabel: string;
  nameMonitored: string | null;
}

interface AlertExportResponse {
  data: { rows: AlertExportRow[]; count: number };
  requestId: string;
}

describe("POST /api/v1/alerts/export", () => {
  it("rejects an unrecognised mode with 400 invalid_body", async () => {
    const app = buildTestApp();
    const res = await app.request("/api/v1/alerts/export", {
      method: "POST",
      headers: {
        "x-test-owner": OWNER_A,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mode: "garbage" }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("invalid_body");
  });

  it("returns the exact alerts requested by ids and decorates with dosar info", async () => {
    const app = buildTestApp();
    const job = seedJob(OWNER_A, "ids-job", {
      kind: "dosar_soap",
      target: { numar_dosar: "1234/3/2024" },
    });
    const runId = seedRun(OWNER_A, job);
    const a = seedAlert(OWNER_A, {
      jobId: job,
      runId,
      title: "first",
      detail: { numar_dosar: "1234/3/2024" },
      dedupKey: "ids-1",
    });
    const b = seedAlert(OWNER_A, {
      jobId: job,
      runId,
      title: "second",
      detail: { numar_dosar: "9999/X/2025" },
      dedupKey: "ids-2",
    });
    seedAlert(OWNER_A, { title: "noise", dedupKey: "ids-3" });

    const res = await app.request("/api/v1/alerts/export", {
      method: "POST",
      headers: {
        "x-test-owner": OWNER_A,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mode: "ids", ids: [a.id, b.id] }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as AlertExportResponse;
    expect(json.data.count).toBe(2);
    const ids = json.data.rows.map((r) => r.alert.id).sort((x, y) => x - y);
    expect(ids).toEqual([a.id, b.id].sort((x, y) => x - y));
    const first = json.data.rows.find((r) => r.alert.id === a.id);
    expect(first?.numarDosar).toBe("1234/3/2024");
    expect(first?.dosarLink).toBe("https://portal.just.ro/SitePages/cautare.aspx?k=1234%2F3%2F2024");
  });

  it("does not leak cross-owner alerts requested by id", async () => {
    const app = buildTestApp();
    const foreign = seedAlert(OWNER_B, { title: "foreign", dedupKey: "leak-1" });
    const own = seedAlert(OWNER_A, { title: "own", dedupKey: "leak-2" });

    const res = await app.request("/api/v1/alerts/export", {
      method: "POST",
      headers: {
        "x-test-owner": OWNER_A,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mode: "ids", ids: [foreign.id, own.id] }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as AlertExportResponse;
    expect(json.data.count).toBe(1);
    expect(json.data.rows[0].alert.id).toBe(own.id);
  });

  it("supports filters mode and ANDs them with owner scope", async () => {
    const app = buildTestApp();
    const dosarJob = seedJob(OWNER_A, "filt-dosar", {
      kind: "dosar_soap",
      target: { numar_dosar: "1234/3/2024" },
    });
    const nameJob = seedJob(OWNER_A, "filt-name", {
      kind: "name_soap",
      target: { name_normalized: "ACME SRL" },
    });
    seedAlert(OWNER_A, {
      jobId: dosarJob,
      runId: seedRun(OWNER_A, dosarJob),
      title: "dosar one",
      severity: "critical",
      dedupKey: "f1",
    });
    seedAlert(OWNER_A, {
      jobId: nameJob,
      runId: seedRun(OWNER_A, nameJob),
      title: "name one",
      severity: "info",
      dedupKey: "f2",
    });

    const res = await app.request("/api/v1/alerts/export", {
      method: "POST",
      headers: {
        "x-test-owner": OWNER_A,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: "filters",
        filters: { jobKind: "dosar_soap" },
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as AlertExportResponse;
    expect(json.data.count).toBe(1);
    expect(json.data.rows[0].alert.title).toBe("dosar one");
  });

  it("supports range mode and includes dismissed alerts in the window", async () => {
    const app = buildTestApp();
    const job = seedJob(OWNER_A, "range-job");
    const runId = seedRun(OWNER_A, job);
    const inWindow = seedAlert(OWNER_A, {
      jobId: job,
      runId,
      title: "inside",
      dedupKey: "r1",
    });
    seedAlert(OWNER_A, { jobId: job, runId, title: "noise", dedupKey: "r2" });

    // Force the in-window alert to a known created_at and dismiss it; the
    // noise alert keeps its current_timestamp default which won't fall inside
    // the historical range we ask for below.
    getDb()
      .prepare("UPDATE monitoring_alerts SET created_at = ?, dismissed_at = ? WHERE id = ?")
      .run("2026-04-15T10:00:00.000Z", "2026-04-15T11:00:00.000Z", inWindow.id);

    const res = await app.request("/api/v1/alerts/export", {
      method: "POST",
      headers: {
        "x-test-owner": OWNER_A,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: "range",
        from: "2026-04-15T00:00:00.000Z",
        to: "2026-04-15T23:59:59.000Z",
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as AlertExportResponse;
    expect(json.data.count).toBe(1);
    expect(json.data.rows[0].alert.id).toBe(inWindow.id);
    expect(json.data.rows[0].alert.dismissed_at).toBeTruthy();
  });

  it("rejects range mode without both from + to (Zod 400)", async () => {
    const app = buildTestApp();
    const res = await app.request("/api/v1/alerts/export", {
      method: "POST",
      headers: {
        "x-test-owner": OWNER_A,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mode: "range", from: "2026-04-15T00:00:00.000Z" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects ids mode with empty array", async () => {
    const app = buildTestApp();
    const res = await app.request("/api/v1/alerts/export", {
      method: "POST",
      headers: {
        "x-test-owner": OWNER_A,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mode: "ids", ids: [] }),
    });
    expect(res.status).toBe(400);
  });
});

interface AlertDismissBulkResponse {
  data: { dismissedCount: number; alreadyDismissedCount: number; totalMatched: number };
  requestId: string;
}

describe("POST /api/v1/alerts/dismiss-bulk", () => {
  it("dismisses owned alerts requested by ids and ignores foreign ids", async () => {
    const app = buildTestApp();
    const a = seedAlert(OWNER_A, { title: "first", dedupKey: "db-1" });
    const b = seedAlert(OWNER_A, { title: "second", dedupKey: "db-2" });
    const foreign = seedAlert(OWNER_B, { title: "foreign", dedupKey: "db-3" });

    const res = await app.request("/api/v1/alerts/dismiss-bulk", {
      method: "POST",
      headers: {
        "x-test-owner": OWNER_A,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mode: "ids", ids: [a.id, b.id, foreign.id] }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as AlertDismissBulkResponse;
    expect(json.data.totalMatched).toBe(2);
    expect(json.data.dismissedCount).toBe(2);
    expect(json.data.alreadyDismissedCount).toBe(0);

    // Owner A's rows are now dismissed; owner B's row is untouched.
    const dbRows = getDb().prepare("SELECT id, dismissed_at FROM monitoring_alerts ORDER BY id ASC").all() as {
      id: number;
      dismissed_at: string | null;
    }[];
    const aRow = dbRows.find((r) => r.id === a.id);
    const bRow = dbRows.find((r) => r.id === b.id);
    const foreignRow = dbRows.find((r) => r.id === foreign.id);
    expect(aRow?.dismissed_at).toBeTruthy();
    expect(bRow?.dismissed_at).toBeTruthy();
    expect(foreignRow?.dismissed_at).toBeNull();
  });

  it("is idempotent — re-dismissing already-closed alerts reports them as already dismissed", async () => {
    const app = buildTestApp();
    const alert = seedAlert(OWNER_A, { dedupKey: "db-idem" });

    const first = await app.request("/api/v1/alerts/dismiss-bulk", {
      method: "POST",
      headers: { "x-test-owner": OWNER_A, "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "ids", ids: [alert.id] }),
    });
    expect(first.status).toBe(200);

    const second = await app.request("/api/v1/alerts/dismiss-bulk", {
      method: "POST",
      headers: { "x-test-owner": OWNER_A, "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "ids", ids: [alert.id] }),
    });
    expect(second.status).toBe(200);
    const json = (await second.json()) as AlertDismissBulkResponse;
    expect(json.data.totalMatched).toBe(1);
    expect(json.data.dismissedCount).toBe(0);
    expect(json.data.alreadyDismissedCount).toBe(1);
  });

  it("dismisses all alerts matching filters (filters mode)", async () => {
    const app = buildTestApp();
    const dosarJob = seedJob(OWNER_A, "db-filt-dosar", {
      kind: "dosar_soap",
      target: { numar_dosar: "1234/3/2024" },
    });
    const nameJob = seedJob(OWNER_A, "db-filt-name", {
      kind: "name_soap",
      target: { name_normalized: "ACME SRL" },
    });
    const dosarAlert = seedAlert(OWNER_A, {
      jobId: dosarJob,
      runId: seedRun(OWNER_A, dosarJob),
      title: "dosar",
      dedupKey: "db-f1",
    });
    const nameAlert = seedAlert(OWNER_A, {
      jobId: nameJob,
      runId: seedRun(OWNER_A, nameJob),
      title: "name",
      dedupKey: "db-f2",
    });

    const res = await app.request("/api/v1/alerts/dismiss-bulk", {
      method: "POST",
      headers: { "x-test-owner": OWNER_A, "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "filters",
        filters: { jobKind: "dosar_soap" },
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as AlertDismissBulkResponse;
    expect(json.data.totalMatched).toBe(1);
    expect(json.data.dismissedCount).toBe(1);

    const rows = getDb().prepare("SELECT id, dismissed_at FROM monitoring_alerts ORDER BY id ASC").all() as {
      id: number;
      dismissed_at: string | null;
    }[];
    const dosarRow = rows.find((r) => r.id === dosarAlert.id);
    const nameRow = rows.find((r) => r.id === nameAlert.id);
    expect(dosarRow?.dismissed_at).toBeTruthy();
    expect(nameRow?.dismissed_at).toBeNull();
  });

  it("returns 200 with zero rows when no alerts match the filter", async () => {
    const app = buildTestApp();
    seedAlert(OWNER_A, { kind: "dosar_new", dedupKey: "db-z1" });

    const res = await app.request("/api/v1/alerts/dismiss-bulk", {
      method: "POST",
      headers: { "x-test-owner": OWNER_A, "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "filters",
        filters: { kind: "source_error" },
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as AlertDismissBulkResponse;
    expect(json.data.totalMatched).toBe(0);
    expect(json.data.dismissedCount).toBe(0);
  });

  it("does not leak cross-owner alerts in filters mode", async () => {
    const app = buildTestApp();
    const own = seedAlert(OWNER_A, { dedupKey: "db-iso-own" });
    const foreign = seedAlert(OWNER_B, { dedupKey: "db-iso-foreign" });

    const res = await app.request("/api/v1/alerts/dismiss-bulk", {
      method: "POST",
      headers: { "x-test-owner": OWNER_A, "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "filters", filters: {} }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as AlertDismissBulkResponse;
    expect(json.data.totalMatched).toBe(1);
    expect(json.data.dismissedCount).toBe(1);

    const ownDb = getDb().prepare("SELECT dismissed_at FROM monitoring_alerts WHERE id = ?").get(own.id) as {
      dismissed_at: string | null;
    };
    const foreignDb = getDb().prepare("SELECT dismissed_at FROM monitoring_alerts WHERE id = ?").get(foreign.id) as {
      dismissed_at: string | null;
    };
    expect(ownDb.dismissed_at).toBeTruthy();
    expect(foreignDb.dismissed_at).toBeNull();
  });

  it("rejects ids mode with empty array (Zod 400)", async () => {
    const app = buildTestApp();
    const res = await app.request("/api/v1/alerts/dismiss-bulk", {
      method: "POST",
      headers: { "x-test-owner": OWNER_A, "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "ids", ids: [] }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("invalid_body");
  });

  it("rejects unrecognised mode (Zod 400)", async () => {
    const app = buildTestApp();
    const res = await app.request("/api/v1/alerts/dismiss-bulk", {
      method: "POST",
      headers: { "x-test-owner": OWNER_A, "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "garbage" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects filters mode with includeDismissed (extra key Zod 400)", async () => {
    // Our schema is .strict() so an unknown key surfaces as 400 — defends the
    // `Inchide toate` UX promise that already-dismissed rows are never touched.
    const app = buildTestApp();
    const res = await app.request("/api/v1/alerts/dismiss-bulk", {
      method: "POST",
      headers: { "x-test-owner": OWNER_A, "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "filters",
        filters: { includeDismissed: true },
      }),
    });
    expect(res.status).toBe(400);
  });

  // v2.16.1 — regression: pre-fix, dismiss-bulk's inline kind enum dropped
  // `termen_dupa_solutie`, so filtering by the v2.15.0 composite kind returned
  // 400 invalid_body. Once the route consumes the shared ALERT_KINDS constant,
  // any future kind addition must keep this test green.
  it("accepts kind=termen_dupa_solutie in filters mode (v2.15.0 composite)", async () => {
    const app = buildTestApp();
    seedAlert(OWNER_A, { kind: "termen_dupa_solutie", dedupKey: "db-tds-1" });
    seedAlert(OWNER_A, { kind: "termen_new", dedupKey: "db-tds-2" });

    const res = await app.request("/api/v1/alerts/dismiss-bulk", {
      method: "POST",
      headers: { "x-test-owner": OWNER_A, "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "filters",
        filters: { kind: "termen_dupa_solutie" },
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as AlertDismissBulkResponse;
    expect(json.data.totalMatched).toBe(1);
    expect(json.data.dismissedCount).toBe(1);
  });
});

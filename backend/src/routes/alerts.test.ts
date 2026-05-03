// Integration tests for /api/v1/alerts (PR-6 backend worker).

import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fsPromises from "fs/promises";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getAlertSubscriberCount,
  insertAlert,
  type MonitoringAlertRow,
} from "../db/monitoringAlertsRepository.ts";
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
  } = {},
): number {
  const kind = options.kind ?? "dosar_soap";
  const target = options.target ?? {};
  const info = getDb()
    .prepare(
      `INSERT INTO monitoring_jobs
         (owner_id, kind, target_json, target_hash, cadence_sec,
          alert_config_json, next_run_at)
       VALUES (?, ?, ?, ?, 14400, '{}', '2026-04-28T12:00:00.000Z')`,
    )
    .run(ownerId, kind, JSON.stringify(target), hashSeed);
  return info.lastInsertRowid as number;
}

function seedRun(ownerId: string, jobId: number): number {
  const info = getDb()
    .prepare(
      `INSERT INTO monitoring_runs (owner_id, job_id, started_at, status)
       VALUES (?, ?, ?, 'running')`,
    )
    .run(ownerId, jobId, "2026-04-28T10:00:00.000Z");
  return info.lastInsertRowid as number;
}

function seedAlert(
  ownerId: string,
  overrides: Partial<Parameters<typeof insertAlert>[0]> = {},
): MonitoringAlertRow {
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
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(
    tmpRoot,
    "legal-dashboard.db",
  );
  const seed = new Database(process.env.LEGAL_DASHBOARD_DB_PATH);
  seed.close();
  getDb();
});

afterEach(async () => {
  closeDb();
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
    const pageJson = await page.json() as {
      data: { rows: MonitoringAlertRow[]; total: number; page: number; pageSize: number };
      requestId: string;
    };
    expect(pageJson.requestId).toBeTruthy();
    expect(pageJson.data.total).toBe(2);
    expect(pageJson.data.rows).toHaveLength(1);
    expect(pageJson.data.rows[0].id).toBe(second.id);

    const filtered = await app.request(
      "/api/v1/alerts?kind=source_error&severity=critical&isNew=true&dismissed=false",
      { headers: { "x-test-owner": OWNER_A } },
    );
    expect(filtered.status).toBe(200);
    const filteredJson = await filtered.json() as {
      data: { rows: MonitoringAlertRow[]; total: number };
    };
    expect(filteredJson.data.total).toBe(1);
    expect(filteredJson.data.rows[0].id).toBe(second.id);
    expect(filteredJson.data.rows.map((row) => row.id)).not.toContain(first.id);

    const bob = await app.request("/api/v1/alerts", {
      headers: { "x-test-owner": OWNER_B },
    });
    const bobJson = await bob.json() as { data: { rows: MonitoringAlertRow[]; total: number } };
    expect(bobJson.data.total).toBe(1);
    expect(bobJson.data.rows[0].owner_id).toBe(OWNER_B);
  });

  it("rejects invalid query parameters", async () => {
    const app = buildTestApp();
    const res = await app.request("/api/v1/alerts?pageSize=999");
    expect(res.status).toBe(400);
    const json = await res.json() as { error: { code: string } };
    expect(json.error.code).toBe("invalid_query");
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
    const json = await res.json() as AlertListResponse;
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
    const json = await res.json() as AlertListResponse;
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
    const plainJson = await plain.json() as AlertListResponse;
    expect(plainJson.data.total).toBe(1);
    expect(plainJson.data.rows[0].title).toBe("stefan");

    const accented = await app.request(`/api/v1/alerts?q=${encodeURIComponent("Ștefan")}`, {
      headers: { "x-test-owner": OWNER_A },
    });
    expect(accented.status).toBe(200);
    const accentedJson = await accented.json() as AlertListResponse;
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
    const json = await res.json() as AlertListResponse;
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
    const json = await res.json() as AlertListResponse;
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
    const seenJson = await seen.json() as { data: MonitoringAlertRow };
    expect(seenJson.data.is_new).toBe(0);
    expect(seenJson.data.read_at).toBeTruthy();
    expect(seenJson.data.dismissed_at).toBeNull();

    const dismissed = await app.request(`/api/v1/alerts/${alert.id}/dismissed`, {
      method: "PATCH",
      headers: { "x-test-owner": OWNER_A },
    });
    expect(dismissed.status).toBe(200);
    const dismissedJson = await dismissed.json() as { data: MonitoringAlertRow };
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

// Integration tests for /api/v1/monitoring/jobs (PR-3).
//
// Coverage:
//   - POST creates job → 201 + envelope shape + audit row
//   - POST replay with same client_request_id → 200 + same id, no audit
//   - POST same target+kind without client_request_id → 200 (duplicate), no audit
//   - POST invalid kind / malformed numar_dosar → 422 with zod issues
//   - POST malformed JSON body → 400
//   - GET/PATCH/DELETE on another owner's job → 404 (no ownership leak)
//   - PATCH writes audit_log entry with action `monitoring.job.updated`
//   - DELETE writes audit_log entry with action `monitoring.job.deleted`
//   - x-request-id propagation: inbound valid id is echoed; otherwise UUID minted
//   - List filter by kind / active flag returns owner-scoped paginated result

import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../db/schema.ts";
import { getAuditEvents } from "../db/auditRepository.ts";
import type { MonitoringJobRow } from "../db/monitoringJobsRepository.ts";
import { requestIdContext } from "../middleware/requestId.ts";
import {
  getMonitoringSchedulerStatus,
  monitoringRouter,
  setMonitoringScheduler,
  type MonitoringSchedulerHandle,
} from "./monitoring.ts";

let tmpRoot: string;
let dbPath: string;

// Build a test app that lets the caller pick an owner per-request via the
// `x-test-owner` header. ownerContext middleware in production always sets
// "local"; here we need to fake "alice"/"bob" to verify owner isolation.
function buildTestApp() {
  const app = new Hono();
  app.use("*", async (c, next) => {
    const fakeOwner = c.req.header("x-test-owner") ?? "local";
    c.set("ownerId", fakeOwner);
    await next();
  });
  app.use("*", requestIdContext);
  app.route("/api/v1/monitoring", monitoringRouter);
  return app;
}

async function postJson(
  app: ReturnType<typeof buildTestApp>,
  url: string,
  body: unknown,
  opts: { owner?: string; requestId?: string; rawBody?: string } = {}
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.owner) headers["x-test-owner"] = opts.owner;
  if (opts.requestId) headers["x-request-id"] = opts.requestId;
  return app.request(url, {
    method: "POST",
    headers,
    body: opts.rawBody !== undefined ? opts.rawBody : JSON.stringify(body),
  });
}

const validDosarBody = {
  kind: "dosar_soap" as const,
  target: { numar_dosar: "1234/180/2024" },
  cadence_sec: 3600,
};

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-monitoring-routes-"));
  dbPath = path.join(tmpRoot, "legal-dashboard.db");
  process.env.LEGAL_DASHBOARD_DB_PATH = dbPath;
  const seed = new Database(dbPath);
  seed.close();
  getDb();
});

afterEach(async () => {
  setMonitoringScheduler(null);
  closeDb();
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("POST /api/v1/monitoring/jobs", () => {
  it("creates a job and returns 201 with envelope shape", async () => {
    const app = buildTestApp();
    const res = await postJson(app, "/api/v1/monitoring/jobs", validDosarBody);
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      data: { id: number; kind: string; target_hash: string; cadence_sec: number };
      requestId: string;
      error?: unknown;
    };
    expect(json.error).toBeUndefined();
    expect(json.data.kind).toBe("dosar_soap");
    expect(json.data.cadence_sec).toBe(3600);
    expect(json.data.target_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(json.data.id).toBeGreaterThan(0);
    expect(json.requestId).toBeTruthy();
  });

  it("freshly-created job is claim-eligible immediately (C6)", async () => {
    // Smoke finding: pre-C6 a new job had next_run_at = now + cadence, so a
    // user creating a daily monitor saw "Niciodata" in the UI for 24h with no
    // baseline snapshot. The first tick must run on the very next scheduler
    // wake-up, not after a full cadence delay.
    const app = buildTestApp();
    const before = Date.now();
    const res = await postJson(app, "/api/v1/monitoring/jobs", {
      ...validDosarBody,
      cadence_sec: 86400, // daily
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      data: { id: number; next_run_at: string };
    };
    const nextRunMs = new Date(json.data.next_run_at).getTime();
    // next_run_at must be at-or-before now (within a small tolerance for the
    // post-insert SELECT round trip), NOT now + 86400_000.
    expect(nextRunMs).toBeLessThanOrEqual(Date.now());
    expect(nextRunMs).toBeGreaterThanOrEqual(before - 1000);
  });

  it("writes an audit_log entry on fresh insert", async () => {
    const app = buildTestApp();
    const res = await postJson(app, "/api/v1/monitoring/jobs", validDosarBody);
    expect(res.status).toBe(201);
    const json = (await res.json()) as { data: { id: number } };

    const events = getAuditEvents({ ownerId: "local", action: "monitoring.job.created" });
    expect(events).toHaveLength(1);
    expect(events[0].target_kind).toBe("monitoring_job");
    expect(events[0].target_id).toBe(String(json.data.id));
    expect(JSON.parse(events[0].detail_json)).toMatchObject({
      kind: "dosar_soap",
      target_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it("client_request_id replay returns 200 with same id, no second audit row", async () => {
    const app = buildTestApp();
    const body = { ...validDosarBody, client_request_id: "req-abc-123" };
    const first = await postJson(app, "/api/v1/monitoring/jobs", body);
    expect(first.status).toBe(201);
    const firstJson = (await first.json()) as { data: { id: number } };

    const second = await postJson(app, "/api/v1/monitoring/jobs", body);
    expect(second.status).toBe(200);
    const secondJson = (await second.json()) as { data: { id: number } };
    expect(secondJson.data.id).toBe(firstJson.data.id);

    const events = getAuditEvents({ ownerId: "local", action: "monitoring.job.created" });
    expect(events).toHaveLength(1); // only the original
  });

  it("client_request_id reused with different intent returns 409 idempotency_conflict + audits", async () => {
    // Same client_request_id, but second POST changes the kind from
    // dosar_soap to name_soap. Silently aliasing would mask a real
    // programmer error or replay attack — must surface as 409.
    const app = buildTestApp();
    const body1 = { ...validDosarBody, client_request_id: "req-conflict-1" };
    const first = await postJson(app, "/api/v1/monitoring/jobs", body1);
    expect(first.status).toBe(201);
    const firstJson = (await first.json()) as { data: { id: number } };

    const body2 = {
      kind: "name_soap" as const,
      target: { name_normalized: "POPESCU ION" },
      cadence_sec: 3600,
      client_request_id: "req-conflict-1",
    };
    const second = await postJson(app, "/api/v1/monitoring/jobs", body2);
    expect(second.status).toBe(409);
    const secondJson = (await second.json()) as {
      data: null;
      error: { code: string; message: string; details: { existing_job_id: number } };
    };
    expect(secondJson.error.code).toBe("idempotency_conflict");
    expect(secondJson.error.details.existing_job_id).toBe(firstJson.data.id);

    // Original row was not mutated, no second `created` audit row.
    const created = getAuditEvents({ ownerId: "local", action: "monitoring.job.created" });
    expect(created).toHaveLength(1);
    const conflicts = getAuditEvents({
      ownerId: "local",
      action: "monitoring.job.idempotency_conflict",
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].target_id).toBe(String(firstJson.data.id));
  });

  it("same target without client_request_id returns 200 (duplicate target_hash)", async () => {
    const app = buildTestApp();
    const first = await postJson(app, "/api/v1/monitoring/jobs", validDosarBody);
    expect(first.status).toBe(201);
    const firstJson = (await first.json()) as { data: { id: number } };

    const second = await postJson(app, "/api/v1/monitoring/jobs", validDosarBody);
    expect(second.status).toBe(200);
    const secondJson = (await second.json()) as { data: { id: number } };
    expect(secondJson.data.id).toBe(firstJson.data.id);

    const events = getAuditEvents({ ownerId: "local", action: "monitoring.job.created" });
    expect(events).toHaveLength(1);
  });

  it("rejects unknown kind with 422 and surfaces zod issues", async () => {
    const app = buildTestApp();
    const res = await postJson(app, "/api/v1/monitoring/jobs", {
      kind: "made_up_kind",
      target: { numar_dosar: "1234/180/2024" },
    });
    expect(res.status).toBe(422);
    const json = (await res.json()) as {
      data: null;
      error: { code: string; message: string; details: unknown[] };
    };
    expect(json.data).toBeNull();
    expect(json.error.code).toBe("invalid_payload");
    expect(Array.isArray(json.error.details)).toBe(true);
    expect(json.error.details.length).toBeGreaterThan(0);
  });

  it("rejects malformed numar_dosar with 422", async () => {
    const app = buildTestApp();
    const res = await postJson(app, "/api/v1/monitoring/jobs", {
      kind: "dosar_soap",
      target: { numar_dosar: "not a dosar" },
    });
    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: { code: string; details: unknown[] } };
    expect(json.error.code).toBe("invalid_payload");
    expect(JSON.stringify(json.error.details)).toContain("numar_dosar");
  });

  it("rejects extra keys on target via .strict()", async () => {
    const app = buildTestApp();
    const res = await postJson(app, "/api/v1/monitoring/jobs", {
      kind: "dosar_soap",
      target: { numar_dosar: "1234/180/2024", extra_key: "hax" },
    });
    expect(res.status).toBe(422);
  });

  it("accepts name_soap once PR-5 runner is dispatchable", async () => {
    const app = buildTestApp();
    const res = await postJson(app, "/api/v1/monitoring/jobs", {
      kind: "name_soap",
      target: { name_normalized: "POPESCU ION" },
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { data: { kind: string; target_json: string } };
    expect(json.data.kind).toBe("name_soap");
    expect(JSON.parse(json.data.target_json)).toEqual({
      name_normalized: "POPESCU ION",
    });
  });

  it("rejects aviz_rnpm with kind_not_implemented (no runner yet)", async () => {
    const app = buildTestApp();
    const res = await postJson(app, "/api/v1/monitoring/jobs", {
      kind: "aviz_rnpm",
      target: { identificator: "12345" },
    });
    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("kind_not_implemented");
  });

  it("rejects malformed JSON body with 400 invalid_json", async () => {
    const app = buildTestApp();
    const res = await postJson(app, "/api/v1/monitoring/jobs", null, {
      rawBody: "{ not valid json",
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("invalid_json");
  });

  it("rejects oversized create payloads before JSON parsing", async () => {
    const app = buildTestApp();
    const res = await postJson(app, "/api/v1/monitoring/jobs", null, {
      rawBody: JSON.stringify({
        ...validDosarBody,
        notes: "x".repeat(20 * 1024),
      }),
    });
    expect(res.status).toBe(413);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("payload_too_large");
  });
});

describe("Owner isolation — GET/PATCH/DELETE /jobs/:id", () => {
  async function createJobAs(app: ReturnType<typeof buildTestApp>, owner: string): Promise<number> {
    const res = await postJson(app, "/api/v1/monitoring/jobs", validDosarBody, { owner });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { data: { id: number } };
    return json.data.id;
  }

  it("GET on another owner's job returns 404 (not 403, no ownership leak)", async () => {
    const app = buildTestApp();
    const aliceJobId = await createJobAs(app, "alice");

    const res = await app.request(`/api/v1/monitoring/jobs/${aliceJobId}`, {
      headers: { "x-test-owner": "bob" },
    });
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("not_found");
  });

  it("PATCH on another owner's job returns 404 + audits update_denied", async () => {
    const app = buildTestApp();
    const aliceJobId = await createJobAs(app, "alice");

    const res = await app.request(`/api/v1/monitoring/jobs/${aliceJobId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-test-owner": "bob" },
      body: JSON.stringify({ active: false }),
    });
    expect(res.status).toBe(404);

    // C5 hardening: cross-owner attempt is recorded as denied so the
    // antifraud trail captures it. Both 404 paths (denied vs not_found)
    // return identical bodies — only the audit log differentiates.
    const denied = getAuditEvents({
      ownerId: "bob",
      action: "monitoring.job.update_denied",
    });
    expect(denied).toHaveLength(1);
    expect(denied[0].target_id).toBe(String(aliceJobId));
    expect(denied[0].outcome).toBe("denied");

    // No "updated" audit was emitted (Alice's row is untouched).
    const ok = getAuditEvents({ action: "monitoring.job.updated" });
    expect(ok).toHaveLength(0);
  });

  it("DELETE on another owner's job returns 404 + audits delete_denied + leaves row intact", async () => {
    const app = buildTestApp();
    const aliceJobId = await createJobAs(app, "alice");

    const res = await app.request(`/api/v1/monitoring/jobs/${aliceJobId}`, {
      method: "DELETE",
      headers: { "x-test-owner": "bob" },
    });
    expect(res.status).toBe(404);

    const denied = getAuditEvents({
      ownerId: "bob",
      action: "monitoring.job.delete_denied",
    });
    expect(denied).toHaveLength(1);
    expect(denied[0].target_id).toBe(String(aliceJobId));
    expect(denied[0].outcome).toBe("denied");

    // No "deleted" audit (the row survives Bob's denied attempt).
    const ok = getAuditEvents({ action: "monitoring.job.deleted" });
    expect(ok).toHaveLength(0);

    // Alice can still read her own job.
    const aliceRead = await app.request(`/api/v1/monitoring/jobs/${aliceJobId}`, {
      headers: { "x-test-owner": "alice" },
    });
    expect(aliceRead.status).toBe(200);
  });

  it("PATCH on a non-existent id does NOT emit a denied audit row", async () => {
    // Distinguishes denied (cross-owner row exists) from not_found
    // (id doesn't exist anywhere) — only the former is audit-worthy noise.
    // A regression that audits all 404s would flood the log on a fuzzer.
    const app = buildTestApp();
    const res = await app.request("/api/v1/monitoring/jobs/999999", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: false }),
    });
    expect(res.status).toBe(404);

    const denied = getAuditEvents({ action: "monitoring.job.update_denied" });
    expect(denied).toHaveLength(0);
  });

  it("each owner sees only their own jobs in list", async () => {
    const app = buildTestApp();
    await createJobAs(app, "alice");
    await postJson(
      app,
      "/api/v1/monitoring/jobs",
      { ...validDosarBody, target: { numar_dosar: "9999/180/2024" } },
      { owner: "bob" }
    );

    const aliceList = await app.request("/api/v1/monitoring/jobs", {
      headers: { "x-test-owner": "alice" },
    });
    const aliceJson = (await aliceList.json()) as {
      data: { rows: { owner_id: string }[]; total: number };
    };
    expect(aliceJson.data.total).toBe(1);
    expect(aliceJson.data.rows.every((r) => r.owner_id === "alice")).toBe(true);

    const bobList = await app.request("/api/v1/monitoring/jobs", {
      headers: { "x-test-owner": "bob" },
    });
    const bobJson = (await bobList.json()) as {
      data: { rows: { owner_id: string }[]; total: number };
    };
    expect(bobJson.data.total).toBe(1);
    expect(bobJson.data.rows.every((r) => r.owner_id === "bob")).toBe(true);
  });
});

describe("PATCH /jobs/:id — write paths", () => {
  it("updates active flag and writes audit row", async () => {
    const app = buildTestApp();
    const create = await postJson(app, "/api/v1/monitoring/jobs", validDosarBody);
    const created = (await create.json()) as { data: { id: number; active: number } };
    expect(created.data.active).toBe(1);

    const patch = await app.request(`/api/v1/monitoring/jobs/${created.data.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: false }),
    });
    expect(patch.status).toBe(200);
    const updated = (await patch.json()) as { data: { active: number } };
    expect(updated.data.active).toBe(0);

    const events = getAuditEvents({ ownerId: "local", action: "monitoring.job.updated" });
    expect(events).toHaveLength(1);
    expect(events[0].target_id).toBe(String(created.data.id));
    // C5 hardening: detail captures before/after for each changed field, not
    // just which keys moved. The audit log now lets you reconstruct the value
    // change without joining against monitoring_jobs (which may be deleted).
    expect(JSON.parse(events[0].detail_json)).toEqual({
      fields: ["active"],
      changed: { active: { before: 1, after: 0 } },
    });
  });

  it("rejects empty PATCH body via Zod refine", async () => {
    const app = buildTestApp();
    const create = await postJson(app, "/api/v1/monitoring/jobs", validDosarBody);
    const created = (await create.json()) as { data: { id: number } };

    const patch = await app.request(`/api/v1/monitoring/jobs/${created.data.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(patch.status).toBe(422);
  });

  it("rejects PATCH with kind / target — those are immutable", async () => {
    const app = buildTestApp();
    const create = await postJson(app, "/api/v1/monitoring/jobs", validDosarBody);
    const created = (await create.json()) as { data: { id: number } };

    const patch = await app.request(`/api/v1/monitoring/jobs/${created.data.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "name_soap" }),
    });
    expect(patch.status).toBe(422);
  });

  it("rejects oversized PATCH payloads before JSON parsing", async () => {
    const app = buildTestApp();
    const create = await postJson(app, "/api/v1/monitoring/jobs", validDosarBody);
    const created = (await create.json()) as { data: { id: number } };

    const patch = await app.request(`/api/v1/monitoring/jobs/${created.data.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: "x".repeat(20 * 1024) }),
    });
    expect(patch.status).toBe(413);
    const json = (await patch.json()) as { error: { code: string } };
    expect(json.error.code).toBe("payload_too_large");
  });
});

describe("DELETE /jobs/:id — write path", () => {
  it("deletes the job and writes audit row", async () => {
    const app = buildTestApp();
    const create = await postJson(app, "/api/v1/monitoring/jobs", validDosarBody);
    const created = (await create.json()) as { data: { id: number } };

    const del = await app.request(`/api/v1/monitoring/jobs/${created.data.id}`, {
      method: "DELETE",
    });
    expect(del.status).toBe(200);
    const json = (await del.json()) as { data: { deleted: boolean } };
    expect(json.data.deleted).toBe(true);

    const events = getAuditEvents({ ownerId: "local", action: "monitoring.job.deleted" });
    expect(events).toHaveLength(1);
    expect(events[0].target_id).toBe(String(created.data.id));

    // C5 hardening: pre-state captured so the audit log preserves the full
    // evidence of what was deleted (kind, target, cadence, alert config).
    // Without this the row vanishes and only the id remains in the log.
    const detail = JSON.parse(events[0].detail_json) as Record<string, unknown>;
    expect(detail.kind).toBe("dosar_soap");
    expect(detail.cadence_sec).toBe(3600);
    expect(detail.target).toEqual({ numar_dosar: "1234/180/2024" });
    expect(detail.alert_config).toBeDefined();

    const after = await app.request(`/api/v1/monitoring/jobs/${created.data.id}`);
    expect(after.status).toBe(404);
  });

  it("returns 400 on non-numeric id", async () => {
    const app = buildTestApp();
    const res = await app.request("/api/v1/monitoring/jobs/abc", { method: "DELETE" });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("invalid_id");
  });
});

describe("requestId propagation", () => {
  it("echoes a valid inbound x-request-id on the envelope and response header", async () => {
    const app = buildTestApp();
    const inbound = "req-abcd-1234";
    const res = await postJson(app, "/api/v1/monitoring/jobs", validDosarBody, {
      requestId: inbound,
    });
    expect(res.headers.get("x-request-id")).toBe(inbound);
    const json = (await res.json()) as { requestId: string };
    expect(json.requestId).toBe(inbound);
  });

  it("mints a UUID when no inbound id is provided", async () => {
    const app = buildTestApp();
    const res = await postJson(app, "/api/v1/monitoring/jobs", validDosarBody);
    const headerId = res.headers.get("x-request-id");
    expect(headerId).toMatch(/^[0-9a-f-]{36}$/i);
    const json = (await res.json()) as { requestId: string };
    expect(json.requestId).toBe(headerId);
  });

  it("ignores malformed inbound id and mints a fresh UUID", async () => {
    const app = buildTestApp();
    // Spaces and short length both fail the VALID_RID regex.
    const res = await postJson(app, "/api/v1/monitoring/jobs", validDosarBody, {
      requestId: "bad id",
    });
    const headerId = res.headers.get("x-request-id");
    expect(headerId).not.toBe("bad id");
    expect(headerId).toMatch(/^[0-9a-f-]{36}$/i);
  });
});

describe("GET /jobs — query handling", () => {
  it("filters by kind and active", async () => {
    const app = buildTestApp();
    await postJson(app, "/api/v1/monitoring/jobs", validDosarBody);
    const secondPost = await postJson(app, "/api/v1/monitoring/jobs", {
      ...validDosarBody,
      target: { numar_dosar: "5555/180/2024" },
    });
    const secondJson = (await secondPost.json()) as { data: { id: number } };
    const secondId = secondJson.data.id;

    // Set the second one inactive.
    const patch = await app.request(`/api/v1/monitoring/jobs/${secondId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: false }),
    });
    expect(patch.status).toBe(200);

    const activeOnly = await app.request("/api/v1/monitoring/jobs?active=true");
    const activeJson = (await activeOnly.json()) as {
      data: { total: number; rows: { id: number; active: number }[] };
    };
    expect(activeJson.data.total).toBe(1);
    expect(activeJson.data.rows[0].id).not.toBe(secondId);
    expect(activeJson.data.rows[0].active).toBe(1);

    const inactiveOnly = await app.request("/api/v1/monitoring/jobs?active=false");
    const inactiveJson = (await inactiveOnly.json()) as {
      data: { total: number; rows: { id: number; active: number }[] };
    };
    expect(inactiveJson.data.total).toBe(1);
    expect(inactiveJson.data.rows[0].id).toBe(secondId);
    expect(inactiveJson.data.rows[0].active).toBe(0);
  });

  it("rejects invalid query (pageSize too large) with 400", async () => {
    const app = buildTestApp();
    const res = await app.request("/api/v1/monitoring/jobs?pageSize=999");
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("invalid_query");
  });

  // Shape comuna pentru cele 4 teste de mai jos: doar campurile pe care le
  // afirmam, dar tipate o singura data ca sa nu repetam cast-urile inline.
  interface QListResponse {
    data: {
      total: number;
      rows: Array<{ target_json: string; kind: string; id: number; active: number }>;
    };
  }

  it("filtreaza dupa q pe numar dosar (case + diacritic insensitive)", async () => {
    const app = buildTestApp();
    await postJson(app, "/api/v1/monitoring/jobs", {
      kind: "dosar_soap",
      target: { numar_dosar: "1234/180/2024" },
      cadence_sec: 3600,
    });
    await postJson(app, "/api/v1/monitoring/jobs", {
      kind: "dosar_soap",
      target: { numar_dosar: "9999/180/2024" },
      cadence_sec: 3600,
    });

    const r = await app.request("/api/v1/monitoring/jobs?q=1234");
    expect(r.status).toBe(200);
    const j = (await r.json()) as QListResponse;
    expect(j.data.total).toBe(1);
    expect(JSON.parse(j.data.rows[0]!.target_json)).toMatchObject({
      numar_dosar: "1234/180/2024",
    });
  });

  it("filtreaza dupa q pe nume (matches name_normalized, diacritic-insensitive)", async () => {
    const app = buildTestApp();
    await postJson(app, "/api/v1/monitoring/jobs", {
      kind: "name_soap",
      target: { name_normalized: "STEFAN POPESCU" },
      cadence_sec: 3600,
    });
    await postJson(app, "/api/v1/monitoring/jobs", {
      kind: "name_soap",
      target: { name_normalized: "ANA IONESCU" },
      cadence_sec: 3600,
    });

    // Query cu diacritice trebuie sa matcheze valoarea fara diacritice in DB.
    const r = await app.request("/api/v1/monitoring/jobs?q=" + encodeURIComponent("Ștefan"));
    expect(r.status).toBe(200);
    const j = (await r.json()) as QListResponse;
    expect(j.data.total).toBe(1);
    expect(JSON.parse(j.data.rows[0]!.target_json)).toMatchObject({
      name_normalized: "STEFAN POPESCU",
    });
  });

  it("filtreaza q + kind combinate (filtre AND-ed)", async () => {
    const app = buildTestApp();
    await postJson(app, "/api/v1/monitoring/jobs", {
      kind: "dosar_soap",
      target: { numar_dosar: "1234/180/2024" },
      cadence_sec: 3600,
    });
    await postJson(app, "/api/v1/monitoring/jobs", {
      kind: "name_soap",
      target: { name_normalized: "FIRMA 1234 SRL" },
      cadence_sec: 3600,
    });

    const r = await app.request("/api/v1/monitoring/jobs?q=1234&kind=name_soap");
    expect(r.status).toBe(200);
    const j = (await r.json()) as QListResponse;
    expect(j.data.total).toBe(1);
    expect(j.data.rows[0]!.kind).toBe("name_soap");
  });

  it("escapeaza wildcard-uri din q (50% nu degenereaza in match-all)", async () => {
    const app = buildTestApp();
    await postJson(app, "/api/v1/monitoring/jobs", {
      kind: "name_soap",
      target: { name_normalized: "FIRMA AB" },
      cadence_sec: 3600,
    });

    // % literal in input nu trebuie sa se transforme in wildcard SQL.
    const r = await app.request("/api/v1/monitoring/jobs?q=" + encodeURIComponent("%"));
    expect(r.status).toBe(200);
    const j = (await r.json()) as QListResponse;
    expect(j.data.total).toBe(0);
  });
});

// PR-4 C5: manual trigger route. Uses a controllable stub scheduler so the
// route's behavior can be exercised without spinning up the real tick loop.
class StubScheduler implements MonitoringSchedulerHandle {
  callCount = 0;
  lastJob: MonitoringJobRow | null = null;
  mode: "ok" | "in_flight" | "not_running" = "ok";
  nextRunId = 4242;

  async runJobNow(job: MonitoringJobRow): Promise<{ runId: number }> {
    this.callCount++;
    this.lastJob = job;
    if (this.mode === "in_flight") {
      const err = new Error("already in flight") as Error & { code?: string };
      err.code = "in_flight";
      throw err;
    }
    if (this.mode === "not_running") {
      const err = new Error("scheduler stopped") as Error & { code?: string };
      err.code = "not_running";
      throw err;
    }
    return { runId: this.nextRunId };
  }
}

describe("POST /api/v1/monitoring/jobs/:id/run", () => {
  it("returns 503 when no scheduler is registered", async () => {
    const app = buildTestApp();
    const create = await postJson(app, "/api/v1/monitoring/jobs", validDosarBody);
    const created = (await create.json()) as { data: { id: number } };

    const res = await app.request(`/api/v1/monitoring/jobs/${created.data.id}/run`, { method: "POST" });
    expect(res.status).toBe(503);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("scheduler_unavailable");
  });

  it("returns 404 on missing job", async () => {
    setMonitoringScheduler(new StubScheduler());
    const app = buildTestApp();
    const res = await app.request("/api/v1/monitoring/jobs/999999/run", {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 when job belongs to another owner (no leak)", async () => {
    setMonitoringScheduler(new StubScheduler());
    const app = buildTestApp();
    const create = await postJson(app, "/api/v1/monitoring/jobs", validDosarBody, {
      owner: "alice",
    });
    const created = (await create.json()) as { data: { id: number } };

    const res = await app.request(`/api/v1/monitoring/jobs/${created.data.id}/run`, {
      method: "POST",
      headers: { "x-test-owner": "bob" },
    });
    expect(res.status).toBe(404);
  });

  it("returns 202 + {runId} and writes monitoring.job.run_manual audit row", async () => {
    const stub = new StubScheduler();
    stub.nextRunId = 777;
    setMonitoringScheduler(stub);
    const app = buildTestApp();
    const create = await postJson(app, "/api/v1/monitoring/jobs", validDosarBody);
    const created = (await create.json()) as { data: { id: number } };

    const res = await app.request(`/api/v1/monitoring/jobs/${created.data.id}/run`, { method: "POST" });
    expect(res.status).toBe(202);
    const json = (await res.json()) as { data: { runId: number } };
    expect(json.data.runId).toBe(777);
    expect(stub.callCount).toBe(1);
    expect(stub.lastJob?.id).toBe(created.data.id);

    const events = getAuditEvents({
      ownerId: "local",
      action: "monitoring.job.run_manual",
    });
    expect(events).toHaveLength(1);
    expect(events[0].target_id).toBe(String(created.data.id));
    expect(JSON.parse(events[0].detail_json)).toEqual({ runId: 777 });
  });

  it("returns 409 when scheduler reports the job is already in flight", async () => {
    const stub = new StubScheduler();
    stub.mode = "in_flight";
    setMonitoringScheduler(stub);
    const app = buildTestApp();
    const create = await postJson(app, "/api/v1/monitoring/jobs", validDosarBody);
    const created = (await create.json()) as { data: { id: number } };

    const res = await app.request(`/api/v1/monitoring/jobs/${created.data.id}/run`, { method: "POST" });
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("in_flight");

    // No audit row when the run did not actually start.
    const events = getAuditEvents({
      ownerId: "local",
      action: "monitoring.job.run_manual",
    });
    expect(events).toHaveLength(0);
  });

  it("returns 503 when scheduler reports it is not running", async () => {
    const stub = new StubScheduler();
    stub.mode = "not_running";
    setMonitoringScheduler(stub);
    const app = buildTestApp();
    const create = await postJson(app, "/api/v1/monitoring/jobs", validDosarBody);
    const created = (await create.json()) as { data: { id: number } };

    const res = await app.request(`/api/v1/monitoring/jobs/${created.data.id}/run`, { method: "POST" });
    expect(res.status).toBe(503);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("scheduler_unavailable");
  });

  it("returns 400 on non-numeric id", async () => {
    setMonitoringScheduler(new StubScheduler());
    const app = buildTestApp();
    const res = await app.request("/api/v1/monitoring/jobs/abc/run", {
      method: "POST",
    });
    expect(res.status).toBe(400);
  });
});

// Tier 3 #12: /health surfaces scheduler liveness via getMonitoringSchedulerStatus.
// We test the helper directly rather than booting index.ts.
describe("getMonitoringSchedulerStatus (Tier 3 #12 — /health hook)", () => {
  class StatusScheduler implements MonitoringSchedulerHandle {
    constructor(private snapshot: { running: boolean; inflight: number }) {}
    async runJobNow(): Promise<{ runId: number }> {
      throw new Error("not used in these tests");
    }
    getStatus() {
      return this.snapshot;
    }
  }

  it("returns null when no scheduler is wired", () => {
    setMonitoringScheduler(null);
    expect(getMonitoringSchedulerStatus()).toBeNull();
  });

  it("returns null when scheduler does not implement getStatus (test stub)", () => {
    setMonitoringScheduler(new StubScheduler());
    expect(getMonitoringSchedulerStatus()).toBeNull();
  });

  it("returns the running snapshot when scheduler implements getStatus", () => {
    setMonitoringScheduler(new StatusScheduler({ running: true, inflight: 3 }));
    expect(getMonitoringSchedulerStatus()).toEqual({
      running: true,
      inflight: 3,
    });
  });

  it("reflects the stopped state once scheduler reports running=false", () => {
    setMonitoringScheduler(new StatusScheduler({ running: false, inflight: 0 }));
    expect(getMonitoringSchedulerStatus()).toEqual({
      running: false,
      inflight: 0,
    });
  });
});

// Tier 5 #T6 — POST /jobs/:id/run wired to a REAL Scheduler instance.
// All other route tests use a stub; this proves the contract end-to-end:
//   - route resolves the job, hands it to scheduler.runJobNow
//   - scheduler claims a runId via insertRunning, fires runOne (background)
//   - the background run finalizes the row to a terminal status
//   - audit_log records monitoring.job.run_manual with the real runId
describe("POST /jobs/:id/run + real Scheduler (#T6)", () => {
  it("manual trigger drives a real Scheduler to a terminal run row", async () => {
    // Lazy import inside the test so the scheduler module isn't loaded for
    // every other route test (some setup/teardown ordering matters less, but
    // this also keeps the heavy dep out of the cold-start path of the file).
    const { Scheduler } = await import("../services/monitoring/scheduler.ts");
    const { FakeClock } = await import("../services/monitoring/clock.ts");
    type RealRunOutcome = { status: "ok"; alertsCreated: number };
    const noopOk = {
      run: async (): Promise<RealRunOutcome> => ({
        status: "ok",
        alertsCreated: 0,
      }),
    };

    const T = new Date("2026-04-28T10:00:00.000Z");
    const realScheduler = new Scheduler({
      clock: new FakeClock(T),
      runners: { dosar_soap: noopOk },
      // Long tickIntervalMs so the scheduler doesn't auto-tick during the
      // test; we drive runJobNow directly via the route.
      tickIntervalMs: 60_000,
      claimLimit: 10,
      jitterSecMax: 0,
    });
    await realScheduler.start();
    setMonitoringScheduler(realScheduler);

    const app = buildTestApp();
    const create = await postJson(app, "/api/v1/monitoring/jobs", validDosarBody);
    const created = (await create.json()) as { data: { id: number } };

    const res = await app.request(`/api/v1/monitoring/jobs/${created.data.id}/run`, { method: "POST" });
    expect(res.status).toBe(202);
    const json = (await res.json()) as { data: { runId: number } };
    expect(json.data.runId).toBeGreaterThan(0);

    // Scheduler runOne is fire-and-forget; wait for the inflight set to drain
    // by polling the public status. With a noop runner this resolves on the
    // next microtask cluster.
    for (let i = 0; i < 50; i++) {
      const status = realScheduler.getStatus();
      if (status.inflight === 0) break;
      await new Promise((r) => setImmediate(r));
    }

    await realScheduler.stop();

    const run = getDb().prepare("SELECT id, status FROM monitoring_runs WHERE id = ?").get(json.data.runId) as {
      id: number;
      status: string;
    };
    expect(run).toBeTruthy();
    expect(run.status).toBe("ok");

    const events = getAuditEvents({
      ownerId: "local",
      action: "monitoring.job.run_manual",
    });
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].detail_json)).toEqual({
      runId: json.data.runId,
    });
  });
});

// Stage 1 (refactor) — caracterizeaza POST /jobs/bulk-delete (F9 din v2.6.4).
// Protejaza Stage 2b (raw SQL move) si Stage 6 (envelope migration).
// Comportament de pastrat:
//   - 422 daca body lipseste / ids[] missing / id non-pozitiv / lista goala.
//   - 400 cand lista depaseste 100.
//   - tranzactie atomica: deleted_ids / inflight_ids / not_found_ids returnate.
//   - inflight check pe scheduler.getInflightAbortController.
//   - cross-owner = not_found (no leak).
//   - audit unic agregat cu actiunea monitoring.job.bulk_deleted.
class StubInflightScheduler implements MonitoringSchedulerHandle {
  inflightIds = new Set<number>();
  async runJobNow(): Promise<{ runId: number }> {
    return { runId: 1 };
  }
  getInflightAbortController(jobId: number): AbortController | undefined {
    return this.inflightIds.has(jobId) ? new AbortController() : undefined;
  }
}

describe("POST /api/v1/monitoring/jobs/bulk-delete (Stage 1 caracterizare)", () => {
  it("returneaza 422 cand ids lipseste din body", async () => {
    const app = buildTestApp();
    const res = await postJson(app, "/api/v1/monitoring/jobs/bulk-delete", {});
    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("invalid_payload");
  });

  it("returneaza 422 cand ids[] e gol", async () => {
    const app = buildTestApp();
    const res = await postJson(app, "/api/v1/monitoring/jobs/bulk-delete", {
      ids: [],
    });
    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("invalid_payload");
  });

  it("returneaza 422 cand un id nu e integer pozitiv", async () => {
    const app = buildTestApp();
    const res = await postJson(app, "/api/v1/monitoring/jobs/bulk-delete", {
      ids: [1, -2],
    });
    expect(res.status).toBe(422);
  });

  it("returneaza 400 cand lista depaseste 100 ids", async () => {
    const app = buildTestApp();
    const res = await postJson(app, "/api/v1/monitoring/jobs/bulk-delete", {
      ids: Array.from({ length: 101 }, (_, i) => i + 1),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("too_many");
  });

  it("sterge joburile existente si raporteaza deleted_ids + total_deleted", async () => {
    const app = buildTestApp();
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      const create = await postJson(app, "/api/v1/monitoring/jobs", {
        kind: "dosar_soap" as const,
        target: { numar_dosar: `100${i}/180/2024` },
        cadence_sec: 3600,
      });
      const created = (await create.json()) as { data: { id: number } };
      ids.push(created.data.id);
    }
    const res = await postJson(app, "/api/v1/monitoring/jobs/bulk-delete", {
      ids,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: {
        deleted_ids: number[];
        inflight_ids: number[];
        not_found_ids: number[];
        total_deleted: number;
      };
    };
    expect(json.data.deleted_ids.sort()).toEqual([...ids].sort());
    expect(json.data.inflight_ids).toEqual([]);
    expect(json.data.not_found_ids).toEqual([]);
    expect(json.data.total_deleted).toBe(3);
  });

  it("marcheaza id-urile cross-owner ca not_found (no leak)", async () => {
    const app = buildTestApp();
    const create = await postJson(
      app,
      "/api/v1/monitoring/jobs",
      {
        kind: "dosar_soap" as const,
        target: { numar_dosar: "2222/180/2024" },
        cadence_sec: 3600,
      },
      { owner: "alice" }
    );
    const created = (await create.json()) as { data: { id: number } };

    const res = await postJson(
      app,
      "/api/v1/monitoring/jobs/bulk-delete",
      { ids: [created.data.id] },
      { owner: "bob" }
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: {
        deleted_ids: number[];
        not_found_ids: number[];
        total_deleted: number;
      };
    };
    expect(json.data.deleted_ids).toEqual([]);
    expect(json.data.not_found_ids).toEqual([created.data.id]);
    expect(json.data.total_deleted).toBe(0);
  });

  it("marcheaza id-urile inflight via scheduler.getInflightAbortController", async () => {
    const sched = new StubInflightScheduler();
    setMonitoringScheduler(sched);
    const app = buildTestApp();
    const create = await postJson(app, "/api/v1/monitoring/jobs", {
      kind: "dosar_soap" as const,
      target: { numar_dosar: "3333/180/2024" },
      cadence_sec: 3600,
    });
    const created = (await create.json()) as { data: { id: number } };
    sched.inflightIds.add(created.data.id);

    const res = await postJson(app, "/api/v1/monitoring/jobs/bulk-delete", {
      ids: [created.data.id],
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { deleted_ids: number[]; inflight_ids: number[] };
    };
    expect(json.data.deleted_ids).toEqual([]);
    expect(json.data.inflight_ids).toEqual([created.data.id]);
  });

  it("scrie un singur audit row monitoring.job.bulk_deleted cu detaliul agregat", async () => {
    const app = buildTestApp();
    const ids: number[] = [];
    for (let i = 0; i < 2; i++) {
      const create = await postJson(app, "/api/v1/monitoring/jobs", {
        kind: "dosar_soap" as const,
        target: { numar_dosar: `444${i}/180/2024` },
        cadence_sec: 3600,
      });
      const created = (await create.json()) as { data: { id: number } };
      ids.push(created.data.id);
    }
    await postJson(app, "/api/v1/monitoring/jobs/bulk-delete", { ids });

    const events = getAuditEvents({
      ownerId: "local",
      action: "monitoring.job.bulk_deleted",
    });
    expect(events).toHaveLength(1);
    const detail = JSON.parse(events[0].detail_json) as {
      deleted_ids: number[];
      inflight_ids: number[];
      not_found_ids: number[];
      count: number;
    };
    expect(detail.deleted_ids.sort()).toEqual([...ids].sort());
    expect(detail.count).toBe(2);
  });
});

// Faza B — per-owner master switch endpoints.
//
// Acopera (PLAN-MASTER-SWITCH-MONITORING.md):
//   - GET intoarce enabled=true pe owner proaspat (rand absent).
//   - PUT { enabled: false } pe rand absent: changed=true + audit
//     monitoring.master_switch.off.
//   - PUT idempotent (acelasi value): changed=false + ZERO audit rows.
//   - PUT { enabled: true } dupa disable: changed=true + audit
//     monitoring.master_switch.on.
//   - Body invalid (cheie extra / tip gresit / vid): 422 invalid_payload.
//   - Owner isolation: PUT pe Alice nu schimba GET-ul pe Bob.
describe("GET/PUT /api/v1/monitoring/master-switch", () => {
  it("GET returns enabled=true for a fresh owner (default)", async () => {
    const app = buildTestApp();
    const res = await app.request("/api/v1/monitoring/master-switch");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { enabled: boolean }; error?: unknown; requestId: string };
    expect(json.error).toBeUndefined();
    expect(json.data.enabled).toBe(true);
    expect(json.requestId).toBeTruthy();
  });

  it("PUT enabled=false on fresh owner returns changed=true and writes audit .off", async () => {
    const app = buildTestApp();
    const res = await app.request("/api/v1/monitoring/master-switch", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { enabled: boolean; changed: boolean };
      error?: unknown;
      requestId: string;
    };
    expect(json.error).toBeUndefined();
    expect(json.data).toEqual({ enabled: false, changed: true });

    const offEvents = getAuditEvents({ ownerId: "local", action: "monitoring.master_switch.off" });
    expect(offEvents).toHaveLength(1);
    expect(offEvents[0].target_kind).toBe("owner_monitoring_settings");
    expect(offEvents[0].target_id).toBe("local");
    expect(JSON.parse(offEvents[0].detail_json)).toMatchObject({ enabled: false });
    // Faza D: audit row capteaza `request_id` din contextul Hono, identic cu
    // requestId-ul intors de envelope. Asta ne permite cross-reference intre
    // log-ul HTTP si audit_log (pagina admin Audit jumpuieste pe el).
    expect(offEvents[0].request_id).toBe(json.requestId);
    expect(offEvents[0].actor_id).toBe("local");

    // GET must reflect the new state.
    const after = await app.request("/api/v1/monitoring/master-switch");
    const afterJson = (await after.json()) as { data: { enabled: boolean } };
    expect(afterJson.data.enabled).toBe(false);
  });

  it("PUT with same value is idempotent: changed=false, no second audit row", async () => {
    const app = buildTestApp();
    // First flip writes audit.
    await app.request("/api/v1/monitoring/master-switch", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    // Second PUT with same value must be a no-op.
    const res = await app.request("/api/v1/monitoring/master-switch", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { enabled: boolean; changed: boolean } };
    expect(json.data).toEqual({ enabled: false, changed: false });

    const offEvents = getAuditEvents({ ownerId: "local", action: "monitoring.master_switch.off" });
    expect(offEvents).toHaveLength(1);
    const onEvents = getAuditEvents({ ownerId: "local", action: "monitoring.master_switch.on" });
    expect(onEvents).toHaveLength(0);
  });

  it("PUT enabled=true on absent row is a no-op (default already true): changed=false, no audit", async () => {
    const app = buildTestApp();
    const res = await app.request("/api/v1/monitoring/master-switch", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { enabled: boolean; changed: boolean } };
    expect(json.data).toEqual({ enabled: true, changed: false });

    expect(getAuditEvents({ ownerId: "local", action: "monitoring.master_switch.on" })).toHaveLength(0);
    expect(getAuditEvents({ ownerId: "local", action: "monitoring.master_switch.off" })).toHaveLength(0);
  });

  it("PUT enabled=true after disable returns changed=true and writes audit .on", async () => {
    const app = buildTestApp();
    await app.request("/api/v1/monitoring/master-switch", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    const res = await app.request("/api/v1/monitoring/master-switch", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { enabled: boolean; changed: boolean } };
    expect(json.data).toEqual({ enabled: true, changed: true });

    const onEvents = getAuditEvents({ ownerId: "local", action: "monitoring.master_switch.on" });
    expect(onEvents).toHaveLength(1);
    expect(onEvents[0].target_kind).toBe("owner_monitoring_settings");
    expect(onEvents[0].target_id).toBe("local");
    expect(JSON.parse(onEvents[0].detail_json)).toMatchObject({ enabled: true });
  });

  it("PUT with invalid body returns 422 invalid_payload", async () => {
    const app = buildTestApp();

    // Missing 'enabled' field.
    const r1 = await app.request("/api/v1/monitoring/master-switch", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(r1.status).toBe(422);
    const j1 = (await r1.json()) as { error: { code: string } };
    expect(j1.error.code).toBe("invalid_payload");

    // Wrong type for 'enabled'.
    const r2 = await app.request("/api/v1/monitoring/master-switch", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: "yes" }),
    });
    expect(r2.status).toBe(422);
    const j2 = (await r2.json()) as { error: { code: string } };
    expect(j2.error.code).toBe("invalid_payload");

    // Extra key rejected by .strict().
    const r3 = await app.request("/api/v1/monitoring/master-switch", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false, extra: 1 }),
    });
    expect(r3.status).toBe(422);
    const j3 = (await r3.json()) as { error: { code: string } };
    expect(j3.error.code).toBe("invalid_payload");

    // Niciun audit row scris pe path-ul de validation failure.
    expect(getAuditEvents({ ownerId: "local", action: "monitoring.master_switch.off" })).toHaveLength(0);
    expect(getAuditEvents({ ownerId: "local", action: "monitoring.master_switch.on" })).toHaveLength(0);
  });

  it("isolates owners: disabling Alice does not affect Bob", async () => {
    const app = buildTestApp();
    await app.request("/api/v1/monitoring/master-switch", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-test-owner": "alice" },
      body: JSON.stringify({ enabled: false }),
    });

    const bobRes = await app.request("/api/v1/monitoring/master-switch", {
      headers: { "x-test-owner": "bob" },
    });
    const bobJson = (await bobRes.json()) as { data: { enabled: boolean } };
    expect(bobJson.data.enabled).toBe(true);

    const aliceRes = await app.request("/api/v1/monitoring/master-switch", {
      headers: { "x-test-owner": "alice" },
    });
    const aliceJson = (await aliceRes.json()) as { data: { enabled: boolean } };
    expect(aliceJson.data.enabled).toBe(false);

    // Audit row scris pe alice, nu pe bob.
    const aliceEvents = getAuditEvents({ ownerId: "alice", action: "monitoring.master_switch.off" });
    expect(aliceEvents).toHaveLength(1);
    const bobEvents = getAuditEvents({ ownerId: "bob", action: "monitoring.master_switch.off" });
    expect(bobEvents).toHaveLength(0);
  });

  // Faza D — UI butonul nu blocheaza repeated clicks during the PUT in-flight
  // window. Daca apar 3 PUT-uri back-to-back cu enabled=false (operator
  // tripleaza click-ul), UPSERT-ul intern garanteaza ca DOAR primul muta
  // starea: cele 2 urmatoare ies cu changed=false si NU mai scriu audit_log.
  //
  // Concurrency note: `Promise.all` lanseaza cele 3 cereri "in paralel" la
  // nivel de event loop, dar handler-ul Hono intra in `getDb().transaction(...)`
  // care e SINCRON pe better-sqlite3 — tranzactiile se serializeaza pe nivelul
  // SQLite WAL, nu se interleaveaza. Asadar nu testam o race condition reala;
  // testam "tripleaza-click" UI semantic: orice ordine de procesare ar fi,
  // exactly-one trebuie sa raporteze changed=true.
  it("rapid back-to-back PUTs with enabled=false are idempotent: 1 audit row, not N", async () => {
    const app = buildTestApp();
    const [r1, r2, r3] = await Promise.all([
      app.request("/api/v1/monitoring/master-switch", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      }),
      app.request("/api/v1/monitoring/master-switch", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      }),
      app.request("/api/v1/monitoring/master-switch", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      }),
    ]);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(200);

    const responses = (await Promise.all([r1.json(), r2.json(), r3.json()])) as {
      data: { enabled: boolean; changed: boolean };
    }[];
    const changedCount = responses.filter((r) => r.data.changed === true).length;
    expect(changedCount).toBe(1);
    expect(responses.every((r) => r.data.enabled === false)).toBe(true);

    // Cu o singura tranzitie de stare, audit_log are exact un rand.
    const offEvents = getAuditEvents({ ownerId: "local", action: "monitoring.master_switch.off" });
    expect(offEvents).toHaveLength(1);
    expect(getAuditEvents({ ownerId: "local", action: "monitoring.master_switch.on" })).toHaveLength(0);
  });

  // Faza D — plan L194 cere explicit acoperire si pe directia .on: dupa ce
  // ownerul a oprit monitorizarea, daca apasa de 3 ori rapid pe "Reia",
  // audit_log trebuie sa primeasca exact UN rand .on (UPSERT idempotent),
  // nu N. Acelasi contract ca testul anterior, dar pentru re-enable.
  it("rapid back-to-back PUTs with enabled=true after disable are idempotent: 1 .on audit row", async () => {
    const app = buildTestApp();
    // Pune ownerul in starea OFF inainte de a triplica click-ul pe Reia.
    await app.request("/api/v1/monitoring/master-switch", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });

    const [r1, r2, r3] = await Promise.all([
      app.request("/api/v1/monitoring/master-switch", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      }),
      app.request("/api/v1/monitoring/master-switch", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      }),
      app.request("/api/v1/monitoring/master-switch", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      }),
    ]);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(200);

    const responses = (await Promise.all([r1.json(), r2.json(), r3.json()])) as {
      data: { enabled: boolean; changed: boolean };
    }[];
    const changedCount = responses.filter((r) => r.data.changed === true).length;
    expect(changedCount).toBe(1);
    expect(responses.every((r) => r.data.enabled === true)).toBe(true);

    const onEvents = getAuditEvents({ ownerId: "local", action: "monitoring.master_switch.on" });
    expect(onEvents).toHaveLength(1);
    // Setup-ul a scris un singur .off; nu trebuie sa apara altul nou.
    expect(getAuditEvents({ ownerId: "local", action: "monitoring.master_switch.off" })).toHaveLength(1);
  });
});

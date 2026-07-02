import Database from "better-sqlite3";
import { Hono } from "hono";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@hono/node-server/conninfo", () => ({ getConnInfo: vi.fn() }));
vi.mock("../services/tokenAlerts.ts", () => ({ notifyTokenNewIp: vi.fn(async () => {}) }));

import { getConnInfo } from "@hono/node-server/conninfo";
import { notifyTokenNewIp } from "../services/tokenAlerts.ts";
import { closeDb, getDb } from "../db/schema.ts";
import { _resetPatAuditForTest, patUsageAudit } from "./patUsageAudit.ts";

const mockedConn = vi.mocked(getConnInfo);
const mockedNotify = vi.mocked(notifyTokenNewIp);

let tmpRoot: string;

function buildApp(tokenId: string | undefined, status = 200) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    if (tokenId) c.set("tokenId", tokenId);
    c.set("ownerId", "alice");
    await next();
  });
  app.use("*", patUsageAudit);
  app.all("*", (c) => c.json({ ok: true }, status as 200));
  return app;
}

function auditCount(outcome: string, tokenId: string): number {
  return (
    getDb()
      .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='api_token.used' AND outcome=? AND target_id=?")
      .get(outcome, tokenId) as { n: number }
  ).n;
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-patusage-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
  new Database(process.env.LEGAL_DASHBOARD_DB_PATH).close();
  getDb();
  vi.clearAllMocks();
  _resetPatAuditForTest();
  mockedConn.mockReturnValue({ remote: { address: "1.2.3.4" } } as ReturnType<typeof getConnInfo>);
  mockedNotify.mockResolvedValue(undefined);
});
afterEach(async () => {
  closeDb();
  // biome-ignore lint/performance/noDelete: env trebuie unset real
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("patUsageAudit", () => {
  it("audits a successful PAT use from a new IP and fires the new-IP alert once", async () => {
    const res = await buildApp("tok1", 200).request("/api/dosare");
    expect(res.status).toBe(200);
    expect(auditCount("ok", "tok1")).toBe(1);
    expect(mockedNotify).toHaveBeenCalledTimes(1);
  });

  it("audits a denied (403) PAT request as denied and does NOT send an email", async () => {
    const res = await buildApp("tok1", 403).request("/api/ai");
    expect(res.status).toBe(403);
    expect(auditCount("denied", "tok1")).toBe(1);
    expect(auditCount("ok", "tok1")).toBe(0);
    expect(mockedNotify).not.toHaveBeenCalled();
  });

  it("samples: a second same-day same-IP success does not re-audit or re-alert", async () => {
    const app = buildApp("tok1", 200);
    await app.request("/api/dosare");
    await app.request("/api/dosare");
    expect(auditCount("ok", "tok1")).toBe(1);
    expect(mockedNotify).toHaveBeenCalledTimes(1);
  });

  it("is a no-op for a non-PAT (no tokenId) request", async () => {
    const res = await buildApp(undefined, 200).request("/api/dosare");
    expect(res.status).toBe(200);
    const total = (
      getDb().prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='api_token.used'").get() as { n: number }
    ).n;
    expect(total).toBe(0);
  });

  it("does not crash the request if the new-IP alert rejects (best-effort)", async () => {
    mockedNotify.mockRejectedValue(new Error("smtp down"));
    const res = await buildApp("tok1", 200).request("/api/dosare");
    expect(res.status).toBe(200);
  });
});

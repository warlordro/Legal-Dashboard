// v2.43.0 (rnpm-split): router admin pentru backup-urile MONOLITULUI
// (/api/v1/admin/backups) — inlocuieste rutele vechi de monolit din rnpm.ts.

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getBackupDir } from "../db/backup.ts";
import { getAuditEvents } from "../db/auditRepository.ts";
import { __resetRnpmDbForTests } from "../db/rnpmDb.ts";
import { closeDb, getDb } from "../db/schema.ts";
import { insertUser, updateUserRole } from "../db/userRepository.ts";
import { requestIdContext } from "../middleware/requestId.ts";
import { adminBackupsRouter } from "./adminBackups.ts";

const DESKTOP = { "x-legal-dashboard-desktop": "1" } as const;
const JSON_DESKTOP = { "content-type": "application/json", ...DESKTOP } as const;

let tmpRoot: string;

function buildApp(actAs: string) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("ownerId", actAs);
    await next();
  });
  app.use("*", requestIdContext);
  app.route("/api/v1/admin/backups", adminBackupsRouter);
  return app;
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-adminbk-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
  const seed = new Database(process.env.LEGAL_DASHBOARD_DB_PATH);
  seed.close();
  getDb();
  insertUser({ id: "u1", email: "u1@x", displayName: "U1" });
  insertUser({ id: "admin1", email: "admin1@x", displayName: "Admin" });
  updateUserRole("admin1", "admin");
});

afterEach(async () => {
  __resetRnpmDbForTests();
  closeDb();
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("/api/v1/admin/backups — gate + contract", () => {
  it("non-adminul primeste 403 pe toate rutele", async () => {
    const app = buildApp("u1");
    expect((await app.request("/api/v1/admin/backups")).status).toBe(403);
    expect((await app.request("/api/v1/admin/backups/create", { method: "POST", headers: DESKTOP })).status).toBe(403);
    expect(
      (
        await app.request("/api/v1/admin/backups/restore", {
          method: "POST",
          headers: JSON_DESKTOP,
          body: JSON.stringify({ name: "legal-dashboard.x.db" }),
        })
      ).status
    ).toBe(403);
    expect((await app.request("/api/v1/admin/backups", { method: "DELETE", headers: DESKTOP })).status).toBe(403);
  });

  it("admin: create + list + restore + delete pe backup-urile monolitului", async () => {
    const app = buildApp("admin1");

    const created = await app.request("/api/v1/admin/backups/create", { method: "POST", headers: DESKTOP });
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as { data: { name: string }; requestId: string };
    const { name } = createdBody.data;
    expect(name).toMatch(/^legal-dashboard\.manual-/);
    expect(typeof createdBody.requestId).toBe("string");
    expect(fs.existsSync(path.join(getBackupDir(), name))).toBe(true);
    expect(getAuditEvents({ action: "backup.create" }).length).toBe(1);

    const list = await app.request("/api/v1/admin/backups");
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { data: { backups: { name: string }[] } };
    expect(listBody.data.backups.map((b) => b.name)).toContain(name);

    // Scriere post-backup in monolit; restore o intoarce.
    getDb().prepare("INSERT INTO fx_rates (pair, rate, rate_date) VALUES ('USDRON', 5.0, '2099-01-01')").run();
    const restored = await app.request("/api/v1/admin/backups/restore", {
      method: "POST",
      headers: JSON_DESKTOP,
      body: JSON.stringify({ name }),
    });
    expect(restored.status).toBe(200);
    const rBody = (await restored.json()) as { data: { preRestoreName: string } };
    expect(rBody.data.preRestoreName).toMatch(/^legal-dashboard\.pre-restore-/);
    const n = (
      getDb().prepare("SELECT COUNT(*) AS n FROM fx_rates WHERE rate_date = '2099-01-01'").get() as { n: number }
    ).n;
    expect(n).toBe(0);
    expect(getAuditEvents({ action: "backup.restore" }).length).toBe(1);

    const deleted = await app.request("/api/v1/admin/backups", { method: "DELETE", headers: DESKTOP });
    expect(deleted.status).toBe(200);
    const deletedBody = (await deleted.json()) as { data: { deleted: number } };
    expect(deletedBody.data.deleted).toBeGreaterThanOrEqual(1);
    expect(getAuditEvents({ action: "backup.delete_all" }).length).toBe(1);
  });

  it("restore cere header-ul desktop in mod desktop", async () => {
    const app = buildApp("admin1");
    const res = await app.request("/api/v1/admin/backups/restore", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "legal-dashboard.x.db" }),
    });
    expect(res.status).toBe(403);
  });

  it("nume invalid la restore => 400 INVALID_PARAMS", async () => {
    const app = buildApp("admin1");
    const res = await app.request("/api/v1/admin/backups/restore", {
      method: "POST",
      headers: JSON_DESKTOP,
      body: JSON.stringify({ name: "../evil.db" }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error?: { code: string } }).error?.code).toBe("INVALID_PARAMS");
  });
});

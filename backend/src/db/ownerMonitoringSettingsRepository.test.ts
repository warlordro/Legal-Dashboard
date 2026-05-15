import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getMonitoringEnabled,
  getOwnerMonitoringSettings,
  setMonitoringEnabled,
} from "./ownerMonitoringSettingsRepository.ts";
import { closeDb, getDb } from "./schema.ts";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-monitoring-settings-"));
  const dbPath = path.join(tmpRoot, "legal-dashboard.db");
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

describe("ownerMonitoringSettingsRepository", () => {
  it("getMonitoringEnabled returns true when row is absent (default enabled)", () => {
    expect(getMonitoringEnabled("missing")).toBe(true);
  });

  it("getMonitoringEnabled returns false after disabling", () => {
    const result = setMonitoringEnabled("local", false);
    expect(result.changed).toBe(true);
    expect(getMonitoringEnabled("local")).toBe(false);
  });

  it("setMonitoringEnabled(false) on absent row inserts and returns changed=true", () => {
    expect(getOwnerMonitoringSettings("local")).toBeNull();
    const result = setMonitoringEnabled("local", false);
    expect(result).toEqual({ changed: true });

    const row = getOwnerMonitoringSettings("local");
    expect(row).not.toBeNull();
    expect(row?.monitoring_enabled).toBe(0);
    expect(row?.owner_id).toBe("local");
    expect(row?.created_at).toEqual(expect.any(String));
    expect(row?.updated_at).toEqual(expect.any(String));
  });

  it("setMonitoringEnabled(true) on absent row is a no-op (default already true)", () => {
    const result = setMonitoringEnabled("local", true);
    expect(result).toEqual({ changed: false });
    expect(getOwnerMonitoringSettings("local")).toBeNull();
  });

  it("setMonitoringEnabled is idempotent when state is unchanged", () => {
    expect(setMonitoringEnabled("local", false)).toEqual({ changed: true });
    expect(setMonitoringEnabled("local", false)).toEqual({ changed: false });
    expect(setMonitoringEnabled("local", false)).toEqual({ changed: false });
    expect(getMonitoringEnabled("local")).toBe(false);
  });

  it("setMonitoringEnabled(true) on existing-disabled row updates and returns changed=true", () => {
    setMonitoringEnabled("local", false);
    expect(getMonitoringEnabled("local")).toBe(false);

    const result = setMonitoringEnabled("local", true);
    expect(result).toEqual({ changed: true });
    expect(getMonitoringEnabled("local")).toBe(true);

    const row = getOwnerMonitoringSettings("local");
    expect(row?.monitoring_enabled).toBe(1);
  });

  it("updated_at advances on toggle while created_at is preserved", async () => {
    setMonitoringEnabled("local", false);
    const initial = getOwnerMonitoringSettings("local");
    expect(initial).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 1100));

    setMonitoringEnabled("local", true);
    const updated = getOwnerMonitoringSettings("local");
    expect(updated).not.toBeNull();
    expect(updated?.created_at).toBe(initial?.created_at);
    expect(updated?.updated_at).not.toBe(initial?.updated_at);
    expect(updated?.monitoring_enabled).toBe(1);
  });

  it("keeps owners isolated", () => {
    setMonitoringEnabled("local", false);
    expect(getMonitoringEnabled("local")).toBe(false);
    expect(getMonitoringEnabled("other")).toBe(true);
    expect(getOwnerMonitoringSettings("other")).toBeNull();
  });

  it("getOwnerMonitoringSettings returns full row with monitoring_enabled as 0|1", () => {
    setMonitoringEnabled("local", false);
    const row = getOwnerMonitoringSettings("local");
    expect(row).not.toBeNull();
    expect(row?.monitoring_enabled).toBe(0);

    setMonitoringEnabled("local", true);
    const enabled = getOwnerMonitoringSettings("local");
    expect(enabled?.monitoring_enabled).toBe(1);
  });
});

import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fsPromises from "fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getEmailSettings, upsertEmailSettings } from "./ownerEmailSettingsRepository.ts";
import { closeDb, getDb } from "./schema.ts";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-email-settings-"));
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

describe("ownerEmailSettingsRepository", () => {
  it("returns null for missing owner", () => {
    expect(getEmailSettings("missing")).toBeNull();
  });

  it("inserts a new settings row", () => {
    const row = upsertEmailSettings("local", {
      enabled: true,
      toAddress: "alerts@firma.ro",
      minSeverity: "warning",
      dailyReportEnabled: false,
    });
    expect(row).toMatchObject({
      ownerId: "local",
      enabled: true,
      toAddress: "alerts@firma.ro",
      minSeverity: "warning",
      dailyReportEnabled: false,
      lastDailyReportSentFor: null,
    });
    expect(row.createdAt).toEqual(expect.any(String));
    expect(row.updatedAt).toEqual(expect.any(String));
  });

  it("updates existing settings and preserves created_at", async () => {
    const first = upsertEmailSettings("local", {
      enabled: false,
      toAddress: "first@firma.ro",
      minSeverity: "critical",
      dailyReportEnabled: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const second = upsertEmailSettings("local", {
      enabled: true,
      toAddress: "second@firma.ro",
      minSeverity: "info",
      dailyReportEnabled: true,
    });
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).not.toBe(first.updatedAt);
    expect(second.toAddress).toBe("second@firma.ro");
    expect(second.minSeverity).toBe("info");
  });

  it("keeps owners isolated", () => {
    upsertEmailSettings("local", {
      enabled: true,
      toAddress: "local@firma.ro",
      minSeverity: "warning",
      dailyReportEnabled: false,
    });
    expect(getEmailSettings("other")).toBeNull();
  });

  it("trims to_address and stores empty string as null", () => {
    const trimmed = upsertEmailSettings("local", {
      enabled: true,
      toAddress: "  alerts@firma.ro  ",
      minSeverity: "warning",
      dailyReportEnabled: false,
    });
    expect(trimmed.toAddress).toBe("alerts@firma.ro");

    const empty = upsertEmailSettings("local", {
      enabled: false,
      toAddress: "   ",
      minSeverity: "critical",
      dailyReportEnabled: false,
    });
    expect(empty.toAddress).toBeNull();
  });

  it("rejects to_address over 320 characters", () => {
    expect(() =>
      upsertEmailSettings("local", {
        enabled: true,
        toAddress: `${"a".repeat(312)}@firma.ro`,
        minSeverity: "warning",
        dailyReportEnabled: false,
      })
    ).toThrow(/max 320/);
  });

  it("lets the DB CHECK reject invalid min_severity", () => {
    expect(() =>
      upsertEmailSettings("local", {
        enabled: true,
        toAddress: "alerts@firma.ro",
        minSeverity: "debug" as never,
        dailyReportEnabled: false,
      })
    ).toThrow();
  });

  it("persists daily_report_enabled flag and resets on update when omitted", () => {
    const initial = upsertEmailSettings("local", {
      enabled: true,
      toAddress: "alerts@firma.ro",
      minSeverity: "warning",
      dailyReportEnabled: true,
    });
    expect(initial.dailyReportEnabled).toBe(true);

    const updated = upsertEmailSettings("local", {
      enabled: true,
      toAddress: "alerts@firma.ro",
      minSeverity: "warning",
      dailyReportEnabled: false,
    });
    expect(updated.dailyReportEnabled).toBe(false);
  });

  it("listDailyReportCandidates filters by enabled flag and excludes already-sent today", async () => {
    const { listDailyReportCandidates, markDailyReportSent } = await import("./ownerEmailSettingsRepository.ts");
    upsertEmailSettings("local", {
      enabled: true,
      toAddress: "a@firma.ro",
      minSeverity: "warning",
      dailyReportEnabled: true,
    });
    upsertEmailSettings("other", {
      enabled: true,
      toAddress: "b@firma.ro",
      minSeverity: "warning",
      dailyReportEnabled: false,
    });
    expect(listDailyReportCandidates("2026-05-04")).toHaveLength(1);

    markDailyReportSent("local", "2026-05-04");
    expect(listDailyReportCandidates("2026-05-04")).toHaveLength(0);
    expect(listDailyReportCandidates("2026-05-05")).toHaveLength(1);
  });
});

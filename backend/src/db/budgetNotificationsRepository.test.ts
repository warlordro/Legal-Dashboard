// v2.32.0 budgetNotifications state-machine tests.

import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearWarning,
  fireWarning,
  getState,
  isWarningActive,
  markEmailSent,
} from "./budgetNotificationsRepository.ts";
import { insertUser } from "./userRepository.ts";
import { closeDb, getDb } from "./schema.ts";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-budget-notif-"));
  const dbPath = path.join(tmpRoot, "legal-dashboard.db");
  process.env.LEGAL_DASHBOARD_DB_PATH = dbPath;
  const seed = new Database(dbPath);
  seed.close();
  getDb();
  insertUser({ id: "u-1", email: "u1@firma.ro", displayName: "User One" });
});

afterEach(async () => {
  closeDb();
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu undefined.
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("budgetNotificationsRepository — state machine", () => {
  it("fireWarning returns true on first fire (no prior state)", () => {
    expect(fireWarning({ userId: "u-1", feature: "ai.single", thresholdPct: 80 })).toBe(true);
    const state = getState("u-1", "ai.single", 80);
    expect(state).not.toBeNull();
    expect(state?.fired_at).not.toBeNull();
    expect(state?.cleared_at).toBeNull();
  });

  it("fireWarning returns false on second fire while still active (no-op)", () => {
    fireWarning({ userId: "u-1", feature: "ai.single", thresholdPct: 80 });
    expect(fireWarning({ userId: "u-1", feature: "ai.single", thresholdPct: 80 })).toBe(false);
  });

  it("clearWarning resets fired_at + above_threshold_since when active", () => {
    fireWarning({ userId: "u-1", feature: "ai.single", thresholdPct: 80 });
    expect(clearWarning("u-1", "ai.single", 80)).toBe(true);
    const state = getState("u-1", "ai.single", 80);
    expect(state?.fired_at).toBeNull();
    expect(state?.cleared_at).not.toBeNull();
    expect(state?.above_threshold_since).toBeNull();
  });

  it("clearWarning returns false when no active episode", () => {
    expect(clearWarning("u-1", "ai.single", 80)).toBe(false);
  });

  it("fireWarning re-fires after clear (re-arm episode)", () => {
    fireWarning({ userId: "u-1", feature: "ai.single", thresholdPct: 80 });
    clearWarning("u-1", "ai.single", 80);
    expect(fireWarning({ userId: "u-1", feature: "ai.single", thresholdPct: 80 })).toBe(true);
    const state = getState("u-1", "ai.single", 80);
    expect(state?.fired_at).not.toBeNull();
    expect(state?.cleared_at).toBeNull();
    expect(state?.email_sent_at).toBeNull();
  });

  it("markEmailSent marks once per episode", () => {
    fireWarning({ userId: "u-1", feature: "ai.single", thresholdPct: 80 });
    expect(markEmailSent("u-1", "ai.single", 80)).toBe(true);
    expect(markEmailSent("u-1", "ai.single", 80)).toBe(false);
  });

  it("markEmailSent returns false when no active episode", () => {
    expect(markEmailSent("u-1", "ai.single", 80)).toBe(false);
    fireWarning({ userId: "u-1", feature: "ai.single", thresholdPct: 80 });
    clearWarning("u-1", "ai.single", 80);
    expect(markEmailSent("u-1", "ai.single", 80)).toBe(false);
  });

  it("isWarningActive reflects state", () => {
    expect(isWarningActive("u-1", "ai.single", 80)).toBe(false);
    fireWarning({ userId: "u-1", feature: "ai.single", thresholdPct: 80 });
    expect(isWarningActive("u-1", "ai.single", 80)).toBe(true);
    clearWarning("u-1", "ai.single", 80);
    expect(isWarningActive("u-1", "ai.single", 80)).toBe(false);
  });

  it("rejects unsupported threshold_pct", () => {
    expect(() => fireWarning({ userId: "u-1", feature: "ai.single", thresholdPct: 50 })).toThrow(/threshold_pct/);
  });

  it("ON DELETE CASCADE removes notifications when user is deleted", () => {
    fireWarning({ userId: "u-1", feature: "ai.single", thresholdPct: 80 });
    getDb().prepare("DELETE FROM users WHERE id = ?").run("u-1");
    expect(getState("u-1", "ai.single", 80)).toBeNull();
  });
});

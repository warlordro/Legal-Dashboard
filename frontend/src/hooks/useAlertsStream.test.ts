import { describe, expect, it } from "vitest";
import type { MonitoringAlert } from "@/lib/alertsApi";
import {
  buildAlertNotificationPayload,
  notificationStatusAllowsNative,
} from "@/hooks/useAlertsStream";

function alert(overrides: Partial<MonitoringAlert> = {}): MonitoringAlert {
  return {
    id: 42,
    owner_id: "local",
    job_id: 7,
    run_id: 9,
    kind: "termen_new",
    severity: "warning",
    title: "Termen nou in dosar",
    detail_json: "{}",
    dedup_key: "job-7|termen-new",
    is_new: 1,
    created_at: "2026-05-03T10:00:00.000Z",
    read_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

describe("useAlertsStream notification helpers", () => {
  it("builds the native notification payload from an alert", () => {
    expect(buildAlertNotificationPayload(alert())).toEqual({
      title: "Legal Dashboard - alerta noua",
      body: "Termen nou in dosar",
      silent: false,
      tag: "job-7|termen-new",
    });
  });

  it("truncates long notification bodies and falls back to alert id for tag", () => {
    const title = "x".repeat(140);
    expect(buildAlertNotificationPayload(alert({ title, severity: "info", dedup_key: "" }))).toEqual({
      title: "Legal Dashboard - alerta noua",
      body: `${"x".repeat(117)}...`,
      silent: true,
      tag: "alert-42",
    });
  });

  it("allows native notifications unless the OS status is explicitly blocked", () => {
    expect(notificationStatusAllowsNative(null)).toBe(true);
    expect(notificationStatusAllowsNative({
      platform: "win32",
      supported: true,
      state: "unknown",
      canNotify: null,
      reason: "status unknown",
    })).toBe(true);
    expect(notificationStatusAllowsNative({
      platform: "darwin",
      supported: true,
      state: "DO_NOT_DISTURB",
      canNotify: false,
      reason: "do not disturb",
    })).toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { assertOwnerIdForMutation } from "./ownerGuard.ts";

const originalMode = process.env.LEGAL_DASHBOARD_AUTH_MODE;

afterEach(() => {
  if (originalMode === undefined) {
    // biome-ignore lint/performance/noDelete: process.env trebuie unset real intre teste.
    delete process.env.LEGAL_DASHBOARD_AUTH_MODE;
  } else {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = originalMode;
  }
});

describe("assertOwnerIdForMutation", () => {
  describe("desktop mode", () => {
    beforeEach(() => {
      process.env.LEGAL_DASHBOARD_AUTH_MODE = "desktop";
    });

    it("acepts 'local' (desktop fallback owner)", () => {
      expect(() => assertOwnerIdForMutation("local", "test")).not.toThrow();
    });

    it("accepts arbitrary UUID-like values", () => {
      expect(() => assertOwnerIdForMutation("user-1234-uuid", "test")).not.toThrow();
    });

    it("accepts empty string in desktop (noop)", () => {
      expect(() => assertOwnerIdForMutation("", "test")).not.toThrow();
    });

    it("accepts null/undefined in desktop (noop)", () => {
      expect(() => assertOwnerIdForMutation(null, "test")).not.toThrow();
      expect(() => assertOwnerIdForMutation(undefined, "test")).not.toThrow();
    });
  });

  describe("web mode", () => {
    beforeEach(() => {
      process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    });

    it("rejects 'local' (desktop fallback leaked into web)", () => {
      expect(() => assertOwnerIdForMutation("local", "saveAvizFull")).toThrow(
        /saveAvizFull: ownerId="local" not allowed in web mode/
      );
    });

    it("rejects empty string", () => {
      expect(() => assertOwnerIdForMutation("", "deleteAviz")).toThrow(/deleteAviz: ownerId=""/);
    });

    it("rejects null", () => {
      expect(() => assertOwnerIdForMutation(null, "updateJob")).toThrow(/updateJob: ownerId missing/);
    });

    it("rejects undefined", () => {
      expect(() => assertOwnerIdForMutation(undefined, "createJob")).toThrow(/createJob: ownerId missing/);
    });

    it("accepts non-reserved owner ids", () => {
      expect(() => assertOwnerIdForMutation("u-12345", "saveSearch")).not.toThrow();
      expect(() => assertOwnerIdForMutation("user@example.com", "saveSearch")).not.toThrow();
    });
  });
});

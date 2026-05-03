import { describe, expect, it } from "vitest";
import { canSaveEmailSettings } from "./EmailSettingsPanel";

const original = {
  enabled: false,
  toAddress: "",
};

describe("EmailSettingsPanel helpers", () => {
  it("allows save when draft changed", () => {
    expect(canSaveEmailSettings({ ...original, enabled: true, toAddress: "a@firma.ro" }, original)).toBe(true);
  });

  it("blocks save when enabled without address", () => {
    expect(canSaveEmailSettings({ ...original, enabled: true, toAddress: " " }, original)).toBe(false);
  });

  it("blocks save when address is over 320 characters", () => {
    expect(
      canSaveEmailSettings(
        { ...original, toAddress: `${"a".repeat(312)}@firma.ro` },
        original,
      ),
    ).toBe(false);
  });

  it("does not save unchanged drafts", () => {
    expect(canSaveEmailSettings({ ...original }, original)).toBe(false);
  });

  it("compares trimmed addresses", () => {
    expect(
      canSaveEmailSettings(
        { ...original, toAddress: "  alerts@firma.ro  " },
        { ...original, toAddress: "alerts@firma.ro" },
      ),
    ).toBe(false);
  });
});

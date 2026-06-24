import { describe, expect, it } from "vitest";
import { describeBlockedSubResult } from "./rnpmGapReason";
import type { RnpmSplitSubResult } from "@/types/rnpm";

function blocked(gapReason: RnpmSplitSubResult["gapReason"], subTotal = 1700): RnpmSplitSubResult {
  return { label: "lbl", status: "blocked", count: 0, subTotal, gapReason };
}

describe("describeBlockedSubResult — v2.20.0 gap reason humanization", () => {
  it("terminal_cap mentions hard limit + no split axis", () => {
    const txt = describeBlockedSubResult(blocked("terminal_cap", 9999));
    expect(txt).toContain("limita RNPM");
    expect(txt).toContain("9999");
    expect(txt).toContain("fara axa de split");
  });

  it("silent_refusal mentions rate-limit / captcha", () => {
    const txt = describeBlockedSubResult(blocked("silent_refusal", 600));
    expect(txt).toContain("nicio inregistrare livrata");
    expect(txt).toContain("rate-limit");
    expect(txt).toContain("600");
  });

  it("residual_unclassified mentions tier-2 residual gap", () => {
    const txt = describeBlockedSubResult(blocked("residual_unclassified", 1826));
    expect(txt).toContain("partial");
    expect(txt).toContain("tier-2");
    expect(txt).toContain("1826");
  });

  it("blocked fara gapReason cade pe fallback (legacy)", () => {
    const txt = describeBlockedSubResult(blocked(undefined, 1500));
    expect(txt).toContain("blocat");
    expect(txt).toContain("1500");
  });

  it("error pastreaza reason-ul transmis (nu conteaza gapReason)", () => {
    const s: RnpmSplitSubResult = { label: "x", status: "error", count: 0, subTotal: 0, reason: "boom" };
    expect(describeBlockedSubResult(s)).toBe("eroare: boom");
  });

  it("error fara reason -> doar 'eroare'", () => {
    const s: RnpmSplitSubResult = { label: "x", status: "error", count: 0, subTotal: 0 };
    expect(describeBlockedSubResult(s)).toBe("eroare");
  });
});

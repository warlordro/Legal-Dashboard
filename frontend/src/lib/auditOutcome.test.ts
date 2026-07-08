import { describe, expect, it } from "vitest";
import { outcomeLabel } from "./auditOutcome";

describe("outcomeLabel — v2.42.0 audit outcome translation", () => {
  it("translates ok", () => {
    expect(outcomeLabel("ok")).toBe("OK");
  });

  it("translates denied", () => {
    expect(outcomeLabel("denied")).toBe("Refuzat");
  });

  it("translates error", () => {
    expect(outcomeLabel("error")).toBe("Eroare");
  });

  it("falls back to the raw token for an unknown value", () => {
    expect(outcomeLabel("necunoscut" as unknown as "ok")).toBe("necunoscut");
  });
});

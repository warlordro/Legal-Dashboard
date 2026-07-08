import { describe, expect, it } from "vitest";
import { monitoringRunStatusLabel } from "./monitoringRunStatus";

describe("monitoringRunStatusLabel", () => {
  it("traduce statusurile cunoscute", () => {
    expect(monitoringRunStatusLabel("ok")).toBe("OK");
    expect(monitoringRunStatusLabel("partial")).toBe("Partial");
    expect(monitoringRunStatusLabel("error")).toBe("Eroare");
    expect(monitoringRunStatusLabel("skipped")).toBe("Omis");
  });

  it("fallback pe token pentru necunoscute si — pentru lipsa", () => {
    expect(monitoringRunStatusLabel("weird")).toBe("weird");
    expect(monitoringRunStatusLabel(null)).toBe("—");
    expect(monitoringRunStatusLabel(undefined)).toBe("—");
  });
});

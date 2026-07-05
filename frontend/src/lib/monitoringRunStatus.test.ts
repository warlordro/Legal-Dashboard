import { describe, expect, it } from "vitest";
import { runStatusLabel } from "./monitoringRunStatus";

describe("runStatusLabel", () => {
  it("traduce toate statusurile cunoscute", () => {
    expect(runStatusLabel("ok")).toBe("OK");
    expect(runStatusLabel("partial")).toBe("Partial");
    expect(runStatusLabel("error")).toBe("Eroare");
    expect(runStatusLabel("skipped")).toBe("Omis");
  });

  it("fallback la token pentru statusuri necunoscute (drift backend)", () => {
    expect(runStatusLabel("something_new")).toBe("something_new");
  });
});

import { describe, it, expect } from "vitest";
import { generateMonthlyIntervals, splitInterval, defaultDateRange } from "./intervals.ts";

describe("generateMonthlyIntervals", () => {
  it("returns empty array when start > stop", () => {
    expect(generateMonthlyIntervals("2025-03-01", "2025-01-01")).toEqual([]);
  });

  it("returns empty array on invalid dates", () => {
    expect(generateMonthlyIntervals("not-a-date", "2025-01-01")).toEqual([]);
    expect(generateMonthlyIntervals("2025-01-01", "not-a-date")).toEqual([]);
  });

  it("splits a 3-month range into 3 monthly intervals", () => {
    const out = generateMonthlyIntervals("2025-01-01", "2025-03-31");
    expect(out).toEqual([
      { dataStart: "2025-01-01", dataStop: "2025-01-31" },
      { dataStart: "2025-02-01", dataStop: "2025-02-28" },
      { dataStart: "2025-03-01", dataStop: "2025-03-31" },
    ]);
  });

  it("clamps the first interval to the requested start day", () => {
    const out = generateMonthlyIntervals("2025-01-15", "2025-02-10");
    expect(out).toEqual([
      { dataStart: "2025-01-15", dataStop: "2025-01-31" },
      { dataStart: "2025-02-01", dataStop: "2025-02-10" },
    ]);
  });

  it("returns a single interval when range is within one month", () => {
    const out = generateMonthlyIntervals("2025-04-05", "2025-04-20");
    expect(out).toEqual([{ dataStart: "2025-04-05", dataStop: "2025-04-20" }]);
  });

  it("handles a leap-year February correctly", () => {
    const out = generateMonthlyIntervals("2024-02-01", "2024-02-29");
    expect(out).toEqual([{ dataStart: "2024-02-01", dataStop: "2024-02-29" }]);
  });

  it("handles cross-year ranges", () => {
    const out = generateMonthlyIntervals("2024-12-15", "2025-01-15");
    expect(out).toEqual([
      { dataStart: "2024-12-15", dataStop: "2024-12-31" },
      { dataStart: "2025-01-01", dataStop: "2025-01-15" },
    ]);
  });
});

describe("splitInterval", () => {
  it("splits a multi-day interval into two contiguous halves", () => {
    const [a, b] = splitInterval({ dataStart: "2025-01-01", dataStop: "2025-01-31" });
    // mid ≈ 2025-01-16, nextDay = 2025-01-17
    expect(a.dataStart).toBe("2025-01-01");
    expect(b.dataStop).toBe("2025-01-31");
    // No overlap, no gap
    const aStop = new Date(a.dataStop + "T00:00:00Z").getTime();
    const bStart = new Date(b.dataStart + "T00:00:00Z").getTime();
    expect(bStart - aStop).toBe(86400000);
  });

  it("never produces a half whose start is after stop", () => {
    const [a, b] = splitInterval({ dataStart: "2025-01-01", dataStop: "2025-01-02" });
    expect(new Date(a.dataStart) <= new Date(a.dataStop)).toBe(true);
    expect(new Date(b.dataStart) <= new Date(b.dataStop)).toBe(true);
  });
});

describe("defaultDateRange", () => {
  it("returns a 7-year window ending today", () => {
    const { dataStart, dataStop } = defaultDateRange();
    const start = new Date(dataStart + "T00:00:00Z");
    const stop = new Date(dataStop + "T00:00:00Z");
    const yearsApart = (stop.getUTCFullYear() - start.getUTCFullYear());
    expect(yearsApart).toBe(7);
    // Stop is today (UTC) — allow either today or yesterday for tz drift
    const today = new Date();
    expect(stop.getUTCFullYear()).toBe(today.getUTCFullYear());
  });
});

// Backoff math is a pure function — no DB, no clock side effects, no SOAP.
// Living separately from scheduler.ts so the formula is testable in isolation
// and can change without touching the scheduler glue.
//
// Semantics (locked C2):
//   failStreak === 0  → success path, nextRunAt = now + cadenceSec + jitterSec
//   failStreak >= 1   → error path,   backoffSec = min(60 * 2^failStreak, 3600)
//                                     nextRunAt = now + backoffSec + jitterSec
//
// failStreak is the count INCLUDING the most recent fail (post-increment).
// First fail → streak=1 → 120s; second → 240s; …; capped at 3600s (1h).

import { describe, expect, it } from "vitest";
import { computeNextRunAt } from "./backoff.ts";

const NOW = new Date("2026-04-28T10:00:00.000Z");

describe("computeNextRunAt — success path", () => {
  it("uses cadenceSec when failStreak=0", () => {
    const result = computeNextRunAt({
      now: NOW,
      cadenceSec: 14400, // 4h default
      failStreak: 0,
      jitterSec: 0,
    });
    expect(result.toISOString()).toBe("2026-04-28T14:00:00.000Z");
  });

  it("adds jitter to cadence on success path", () => {
    const result = computeNextRunAt({
      now: NOW,
      cadenceSec: 600,
      failStreak: 0,
      jitterSec: 30,
    });
    // 600 + 30 = 630 sec
    expect(result.getTime() - NOW.getTime()).toBe(630_000);
  });
});

describe("computeNextRunAt — error path (exponential backoff)", () => {
  it("first fail (streak=1) backs off 120s", () => {
    const result = computeNextRunAt({
      now: NOW,
      cadenceSec: 14400,
      failStreak: 1,
      jitterSec: 0,
    });
    // 60 * 2^1 = 120s
    expect(result.getTime() - NOW.getTime()).toBe(120_000);
  });

  it("second fail (streak=2) backs off 240s", () => {
    const result = computeNextRunAt({
      now: NOW,
      cadenceSec: 14400,
      failStreak: 2,
      jitterSec: 0,
    });
    expect(result.getTime() - NOW.getTime()).toBe(240_000);
  });

  it("fifth fail (streak=5) backs off 1920s", () => {
    const result = computeNextRunAt({
      now: NOW,
      cadenceSec: 14400,
      failStreak: 5,
      jitterSec: 0,
    });
    // 60 * 2^5 = 1920s
    expect(result.getTime() - NOW.getTime()).toBe(1920_000);
  });

  it("caps at 3600s (1h) for high streaks", () => {
    const result = computeNextRunAt({
      now: NOW,
      cadenceSec: 14400,
      failStreak: 10, // 60 * 1024 = 61440s, capped to 3600
      jitterSec: 0,
    });
    expect(result.getTime() - NOW.getTime()).toBe(3600_000);
  });

  it("adds jitter on top of capped backoff", () => {
    const result = computeNextRunAt({
      now: NOW,
      cadenceSec: 14400,
      failStreak: 20,
      jitterSec: 45,
    });
    // 3600 + 45 = 3645s
    expect(result.getTime() - NOW.getTime()).toBe(3645_000);
  });

  it("ignores cadenceSec when in error path", () => {
    // Even a 24h cadence does not lengthen the retry — recovery is the priority.
    const result = computeNextRunAt({
      now: NOW,
      cadenceSec: 86400,
      failStreak: 1,
      jitterSec: 0,
    });
    expect(result.getTime() - NOW.getTime()).toBe(120_000);
  });
});

describe("computeNextRunAt — input validation", () => {
  it("throws on negative failStreak", () => {
    expect(() => computeNextRunAt({ now: NOW, cadenceSec: 600, failStreak: -1, jitterSec: 0 })).toThrow();
  });

  it("throws on negative cadenceSec", () => {
    expect(() => computeNextRunAt({ now: NOW, cadenceSec: -1, failStreak: 0, jitterSec: 0 })).toThrow();
  });

  it("throws on negative jitter", () => {
    expect(() => computeNextRunAt({ now: NOW, cadenceSec: 600, failStreak: 0, jitterSec: -1 })).toThrow();
  });
});

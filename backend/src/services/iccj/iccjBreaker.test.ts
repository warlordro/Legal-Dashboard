import { beforeEach, describe, expect, it } from "vitest";
import {
  BREAKER_THRESHOLD,
  IccjBreakerOpenError,
  _resetBreakerForTest,
  clampPositiveIntEnv,
  withBreaker,
} from "./iccjBreaker.ts";

beforeEach(() => _resetBreakerForTest());

describe("clampPositiveIntEnv (breaker env guard)", () => {
  it("rejects negative / NaN / zero and keeps a positive value", () => {
    expect(clampPositiveIntEnv(-1, 8)).toBe(8); // negativul e truthy in Number(env)||fallback -> bug fixat
    expect(clampPositiveIntEnv(Number.NaN, 8)).toBe(8);
    expect(clampPositiveIntEnv(0, 8)).toBe(8);
    expect(clampPositiveIntEnv(8.5, 8)).toBe(8); // fractionar -> fallback
    expect(clampPositiveIntEnv(Number.POSITIVE_INFINITY, 8)).toBe(8);
    expect(clampPositiveIntEnv(5, 8)).toBe(5);
  });
  it("the exported BREAKER_THRESHOLD is a finite positive number", () => {
    expect(Number.isFinite(BREAKER_THRESHOLD)).toBe(true);
    expect(BREAKER_THRESHOLD).toBeGreaterThan(0);
  });
});

const distress = () => new Error("ICCJ source error: HTTP 503");
const parseErr = () => new Error("ICCJ parse error: unexpected markup");
const T0 = 1000;

describe("iccjBreaker", () => {
  it("opens after threshold distress failures and then blocks a PAT call", async () => {
    for (let i = 0; i < BREAKER_THRESHOLD; i++) {
      await expect(
        withBreaker(
          "ui",
          async () => {
            throw distress();
          },
          T0
        )
      ).rejects.toThrow();
    }
    await expect(withBreaker("pat", async () => "x", T0)).rejects.toThrow(IccjBreakerOpenError);
  });

  it("a PAT flood alone does NOT open the breaker (weighted, capped below threshold)", async () => {
    for (let i = 0; i < 100; i++) {
      await expect(
        withBreaker(
          "pat",
          async () => {
            throw distress();
          },
          T0
        )
      ).rejects.toThrow();
    }
    // breaker still closed → a ui call runs its fn
    await expect(withBreaker("ui", async () => "ok", T0)).resolves.toBe("ok");
  });

  it("half-open after cooldown: PAT stays blocked, UI gets a single probe that closes on success", async () => {
    for (let i = 0; i < BREAKER_THRESHOLD; i++) {
      await expect(
        withBreaker(
          "ui",
          async () => {
            throw distress();
          },
          T0
        )
      ).rejects.toThrow();
    }
    // within cooldown → everyone blocked
    await expect(withBreaker("ui", async () => "x", T0 + 1000)).rejects.toThrow(IccjBreakerOpenError);
    // after cooldown → PAT blocked, UI probe runs and (on success) closes the breaker
    const afterCooldown = T0 + 31_000;
    await expect(withBreaker("pat", async () => "x", afterCooldown)).rejects.toThrow(IccjBreakerOpenError);
    await expect(withBreaker("ui", async () => "recovered", afterCooldown)).resolves.toBe("recovered");
    // closed again → a subsequent call runs
    await expect(withBreaker("ui", async () => "again", afterCooldown + 1)).resolves.toBe("again");
  });

  it("a non-distress (parse/markup) failure does not open the breaker", async () => {
    for (let i = 0; i < BREAKER_THRESHOLD + 3; i++) {
      await expect(
        withBreaker(
          "ui",
          async () => {
            throw parseErr();
          },
          T0
        )
      ).rejects.toThrow();
    }
    await expect(withBreaker("ui", async () => "ok", T0)).resolves.toBe("ok");
  });

  it("propagates the original error when the breaker is closed", async () => {
    await expect(
      withBreaker(
        "ui",
        async () => {
          throw distress();
        },
        T0
      )
    ).rejects.toThrow(/HTTP 503/);
  });
});

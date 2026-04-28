// Clock abstraction tests — the scheduler's only contact with wall-clock time.
//
// realClock just wraps Date.now / setTimeout / clearTimeout, no logic worth
// testing in isolation. FakeClock is the interesting type: it lets tests
// advance virtual time deterministically and assert which timers fire when.
// All scheduler tests below this point use FakeClock so they don't need to
// `await sleep(60_000)` to test a 60s tick.

import { describe, expect, it } from "vitest";
import { FakeClock, realClock } from "./clock.ts";

describe("realClock", () => {
  it("returns a Date close to system time on now()", () => {
    const before = Date.now();
    const got = realClock.now().getTime();
    const after = Date.now();
    expect(got).toBeGreaterThanOrEqual(before);
    expect(got).toBeLessThanOrEqual(after);
  });

  it("setTimeout/clearTimeout round-trip without firing", async () => {
    let fired = false;
    const handle = realClock.setTimeout(() => {
      fired = true;
    }, 10_000);
    realClock.clearTimeout(handle);
    // Yield the event loop; if the cleared timer fires we'd see it here.
    await new Promise((r) => setImmediate(r));
    expect(fired).toBe(false);
  });
});

describe("FakeClock", () => {
  it("now() returns the seeded time", () => {
    const seed = new Date("2026-04-28T10:00:00.000Z");
    const c = new FakeClock(seed);
    expect(c.now().toISOString()).toBe(seed.toISOString());
  });

  it("advance(ms) moves now() forward", () => {
    const c = new FakeClock(new Date("2026-04-28T10:00:00.000Z"));
    c.advance(5_000);
    expect(c.now().toISOString()).toBe("2026-04-28T10:00:05.000Z");
  });

  it("setTimeout fires when virtual time crosses delay", async () => {
    const c = new FakeClock(new Date("2026-04-28T10:00:00.000Z"));
    let fired = false;
    c.setTimeout(() => {
      fired = true;
    }, 1_000);

    expect(fired).toBe(false);
    await c.advance(999);
    expect(fired).toBe(false);
    await c.advance(1);
    expect(fired).toBe(true);
  });

  it("setTimeout fires multiple due timers in registration order", async () => {
    const c = new FakeClock(new Date("2026-04-28T10:00:00.000Z"));
    const fired: number[] = [];
    c.setTimeout(() => {
      fired.push(1);
    }, 100);
    c.setTimeout(() => {
      fired.push(2);
    }, 200);
    c.setTimeout(() => {
      fired.push(3);
    }, 50);

    await c.advance(300);
    // Fired in due-time order: 50ms first, then 100ms, then 200ms.
    expect(fired).toEqual([3, 1, 2]);
  });

  it("clearTimeout cancels a pending timer", async () => {
    const c = new FakeClock(new Date("2026-04-28T10:00:00.000Z"));
    let fired = false;
    const handle = c.setTimeout(() => {
      fired = true;
    }, 500);
    c.clearTimeout(handle);
    await c.advance(1000);
    expect(fired).toBe(false);
  });

  it("awaits async timer callbacks before resolving advance()", async () => {
    const c = new FakeClock(new Date("2026-04-28T10:00:00.000Z"));
    let resolvedAfter = false;
    c.setTimeout(async () => {
      await new Promise((r) => setImmediate(r));
      resolvedAfter = true;
    }, 100);

    await c.advance(100);
    // advance() waits for the callback (incl. its microtasks) to settle so
    // tests can synchronously assert post-fire state.
    expect(resolvedAfter).toBe(true);
  });
});

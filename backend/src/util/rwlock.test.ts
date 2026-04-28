// RWLock — writer-preference reader/writer lock for the maintenance gate.
// Coverage focus:
//   - multiple readers run concurrently (no serialization between them)
//   - exclusive writer waits for in-flight readers to drain
//   - writer preference: a pending writer blocks NEW readers from cutting
//     in front (otherwise a steady reader stream would starve backups)
//   - chain self-heals after a thrown body (matches old withMaintenanceLock
//     behavior — one bad op must not poison everything behind it)
//   - reentrant-style: read after write, write after read all interleave
//     deterministically by acquire order

import { describe, expect, it } from "vitest";

import { RWLock } from "./rwlock.ts";

// Tiny helpers that turn raw setImmediate / setTimeout into something
// readable inside the assertion order. `tick()` is "yield once to the
// microtask + macrotask queue" so we can observe scheduling effects
// without sleeping arbitrary ms.
function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("RWLock — concurrent readers", () => {
  it("multiple read holders run in parallel (do not serialize)", async () => {
    const lock = new RWLock();
    const events: string[] = [];

    const r1 = lock.withRead(async () => {
      events.push("r1-start");
      await tick();
      events.push("r1-end");
    });
    const r2 = lock.withRead(async () => {
      events.push("r2-start");
      await tick();
      events.push("r2-end");
    });

    await Promise.all([r1, r2]);

    // Both readers must be inside the critical section before either exits —
    // i.e. the two start events fire before either end event. If readers
    // serialized we'd see r1-start, r1-end, r2-start, r2-end.
    expect(events.indexOf("r1-start")).toBeLessThan(events.indexOf("r1-end"));
    expect(events.indexOf("r2-start")).toBeLessThan(events.indexOf("r1-end"));
    expect(events.indexOf("r2-start")).toBeLessThan(events.indexOf("r2-end"));
  });
});

describe("RWLock — exclusive writer waits for readers", () => {
  it("writer acquired only after all in-flight readers release", async () => {
    const lock = new RWLock();
    const events: string[] = [];

    let releaseR1: () => void = () => undefined;
    const r1 = lock.withRead(async () => {
      events.push("r1-start");
      await new Promise<void>((resolve) => {
        releaseR1 = resolve;
      });
      events.push("r1-end");
    });

    // Yield so r1 enters the critical section before we request the writer.
    await tick();

    const w = lock.withWrite(async () => {
      events.push("w-start");
      events.push("w-end");
    });

    // Writer must NOT be inside its body yet — r1 still holds the read lock.
    await tick();
    await tick();
    expect(events).toEqual(["r1-start"]);

    releaseR1();
    await Promise.all([r1, w]);

    expect(events).toEqual(["r1-start", "r1-end", "w-start", "w-end"]);
  });
});

describe("RWLock — writer preference", () => {
  it("new readers queue behind a pending writer (no starvation)", async () => {
    const lock = new RWLock();
    const events: string[] = [];

    let releaseR1: () => void = () => undefined;
    const r1 = lock.withRead(async () => {
      events.push("r1-start");
      await new Promise<void>((resolve) => {
        releaseR1 = resolve;
      });
      events.push("r1-end");
    });
    await tick();

    const w = lock.withWrite(async () => {
      events.push("w-start");
      events.push("w-end");
    });

    // r2 arrives AFTER the writer is pending. Writer preference means r2
    // must wait for w to finish — even though there is an active reader
    // (r1) that would normally allow a parallel read.
    const r2 = lock.withRead(async () => {
      events.push("r2-start");
      events.push("r2-end");
    });

    await tick();
    await tick();
    expect(events).toEqual(["r1-start"]);

    releaseR1();
    await Promise.all([r1, w, r2]);

    // Order: r1 finishes → w runs (writer preference) → r2 runs after w.
    expect(events).toEqual([
      "r1-start",
      "r1-end",
      "w-start",
      "w-end",
      "r2-start",
      "r2-end",
    ]);
  });
});

describe("RWLock — multiple readers after writer drains", () => {
  it("queued readers all run in parallel after writer releases", async () => {
    const lock = new RWLock();
    const events: string[] = [];

    let releaseW: () => void = () => undefined;
    const w = lock.withWrite(async () => {
      events.push("w-start");
      await new Promise<void>((resolve) => {
        releaseW = resolve;
      });
      events.push("w-end");
    });
    await tick();

    const r1 = lock.withRead(async () => {
      events.push("r1-start");
      await tick();
      events.push("r1-end");
    });
    const r2 = lock.withRead(async () => {
      events.push("r2-start");
      await tick();
      events.push("r2-end");
    });

    await tick();
    await tick();
    expect(events).toEqual(["w-start"]);

    releaseW();
    await Promise.all([w, r1, r2]);

    // After w releases, both r1 and r2 enter in parallel — interleaved start
    // events before either end event.
    const r1Start = events.indexOf("r1-start");
    const r2Start = events.indexOf("r2-start");
    const r1End = events.indexOf("r1-end");
    const r2End = events.indexOf("r2-end");
    expect(r1Start).toBeLessThan(r1End);
    expect(r2Start).toBeLessThan(r2End);
    expect(Math.max(r1Start, r2Start)).toBeLessThan(Math.min(r1End, r2End));
  });
});

describe("RWLock — error in body does not poison the lock", () => {
  it("a thrown reader still releases its slot so the next op can run", async () => {
    const lock = new RWLock();

    await expect(
      lock.withRead(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // If the lock leaked, this writer would deadlock waiting on phantom reader.
    let ran = false;
    await lock.withWrite(async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it("a thrown writer still releases its slot so the next op can run", async () => {
    const lock = new RWLock();

    await expect(
      lock.withWrite(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    let ran = false;
    await lock.withRead(async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });
});

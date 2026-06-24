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
    expect(events).toEqual(["r1-start", "r1-end", "w-start", "w-end", "r2-start", "r2-end"]);
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

// Tier 3 #14 — close the TOCTOU window between drain.resolve() and the
// woken waiter's continuation. The audit (rwlock.ts:49,63,83-98) called
// out that drain mutates state lazily — the writer's `writerActive=true`
// runs in the writer's microtask continuation, not in drain itself. That
// leaves a one-microtask window where state introspection sees:
//   writerActive=false, queue empty, activeReaders=0  → "lock is free!"
// even though a writer has just been picked. Currently dormant because
// better-sqlite3 ops are synchronous and no user code interposes between
// drain and the continuation, but the gap will surface the moment a
// future caller starts awaiting inside the maintenance critical section.
//
// We expose the bug deterministically by wrapping each queued waiter's
// resolve() callback with a probe — drain calls .resolve() synchronously,
// so the probe runs at exactly the moment drain hands off, observing
// whatever state drain has (or has not) set. After the fix, drain mutates
// the counters BEFORE resolving; before the fix, the counters are
// untouched and the probe records the broken state.
describe("RWLock — drain mutates state before resolve (TOCTOU)", () => {
  it("writerActive is set synchronously inside drain when a writer is woken", async () => {
    const lock = new RWLock();
    const internals = lock as unknown as {
      writerActive: boolean;
      activeReaders: number;
      queue: { kind: "read" | "write"; resolve: () => void }[];
    };

    let releaseR0!: () => void;
    const r0 = lock.withRead(
      () =>
        new Promise<void>((res) => {
          releaseR0 = res;
        })
    );
    await tick();

    let releaseW1!: () => void;
    const w1 = lock.withWrite(
      () =>
        new Promise<void>((res) => {
          releaseW1 = res;
        })
    );
    await tick();
    expect(internals.queue.length).toBe(1);

    let stateAtResolve: { writerActive: boolean; activeReaders: number } | null = null;
    const writerWaiter = internals.queue[0]!;
    const original = writerWaiter.resolve;
    writerWaiter.resolve = () => {
      stateAtResolve = {
        writerActive: internals.writerActive,
        activeReaders: internals.activeReaders,
      };
      original();
    };

    releaseR0();
    await tick();

    expect(stateAtResolve).not.toBeNull();
    // Post-fix: drain set writerActive=true BEFORE calling resolve, so a
    // synchronous acquireRead in the same microtask cycle would correctly
    // see the lock as held and queue.
    expect(stateAtResolve!.writerActive).toBe(true);
    expect(stateAtResolve!.activeReaders).toBe(0);

    releaseW1();
    await Promise.all([r0, w1]);
  });

  it("activeReaders is set synchronously inside drain when a reader prefix is woken", async () => {
    const lock = new RWLock();
    const internals = lock as unknown as {
      writerActive: boolean;
      activeReaders: number;
      queue: { kind: "read" | "write"; resolve: () => void }[];
    };

    let releaseW1!: () => void;
    const w1 = lock.withWrite(
      () =>
        new Promise<void>((res) => {
          releaseW1 = res;
        })
    );
    await tick();

    // Two readers behind the writer — drain wakes them as a single batch.
    const r1 = lock.withRead(async () => {});
    const r2 = lock.withRead(async () => {});
    await tick();
    expect(internals.queue.length).toBe(2);

    const captured: { activeReaders: number; writerActive: boolean }[] = [];
    for (const waiter of internals.queue) {
      const original = waiter.resolve;
      waiter.resolve = () => {
        captured.push({
          activeReaders: internals.activeReaders,
          writerActive: internals.writerActive,
        });
        original();
      };
    }

    releaseW1();
    await tick();

    // Post-fix: drain incremented activeReaders by 2 BEFORE resolving any
    // waiter, so both probes observe the final count, not the lazy one.
    expect(captured).toEqual([
      { activeReaders: 2, writerActive: false },
      { activeReaders: 2, writerActive: false },
    ]);

    await Promise.all([w1, r1, r2]);
  });
});

describe("RWLock — error in body does not poison the lock", () => {
  it("a thrown reader still releases its slot so the next op can run", async () => {
    const lock = new RWLock();

    await expect(
      lock.withRead(async () => {
        throw new Error("boom");
      })
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
      })
    ).rejects.toThrow("boom");

    let ran = false;
    await lock.withRead(async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });
});

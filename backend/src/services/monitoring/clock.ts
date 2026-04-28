// Clock abstraction — the scheduler's only contact with wall-clock time.
//
// Why: a fake-clock test can advance virtual time millisecond-by-millisecond,
// but `setTimeout`/`Date.now` cannot be controlled in real time. Pulling time
// behind a 4-method interface lets the same scheduler code run against
// realClock in production and FakeClock in tests, without `await sleep(60_000)`
// in any unit test.
//
// Surface:
//   now()              → current time as Date
//   setTimeout(fn, ms) → register a timer, returns opaque handle
//   clearTimeout(h)    → cancel a registered timer
//
// Async-aware: timer callbacks may be async; FakeClock.advance(ms) awaits each
// fired callback (including its returned Promise) before resolving so tests can
// assert post-fire state synchronously.

export type TimerHandle = unknown;

export interface Clock {
  now(): Date;
  setTimeout(fn: () => void | Promise<void>, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

export const realClock: Clock = {
  now: () => new Date(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

interface FakeTimer {
  id: number;
  fireAt: number;
  fn: () => void | Promise<void>;
  cancelled: boolean;
}

export class FakeClock implements Clock {
  private currentMs: number;
  private nextId = 1;
  private timers: FakeTimer[] = [];

  constructor(seed: Date) {
    this.currentMs = seed.getTime();
  }

  now(): Date {
    return new Date(this.currentMs);
  }

  setTimeout(fn: () => void | Promise<void>, ms: number): TimerHandle {
    const timer: FakeTimer = {
      id: this.nextId++,
      fireAt: this.currentMs + ms,
      fn,
      cancelled: false,
    };
    this.timers.push(timer);
    return timer.id;
  }

  clearTimeout(handle: TimerHandle): void {
    const id = handle as number;
    const timer = this.timers.find((t) => t.id === id);
    if (timer) timer.cancelled = true;
  }

  // Advance virtual time by `ms`, firing every due (non-cancelled) timer in
  // due-time order. Awaits each callback's returned promise so async work
  // settles before the caller sees control again.
  async advance(ms: number): Promise<void> {
    const target = this.currentMs + ms;

    while (true) {
      const due = this.timers
        .filter((t) => !t.cancelled && t.fireAt <= target)
        .sort((a, b) => a.fireAt - b.fireAt || a.id - b.id);

      if (due.length === 0) {
        this.currentMs = target;
        return;
      }

      const next = due[0]!;
      this.currentMs = next.fireAt;
      next.cancelled = true; // one-shot timer, prevent re-fire
      // Drop the fired timer from the list so retained refs don't grow.
      this.timers = this.timers.filter((t) => t.id !== next.id);
      await next.fn();
    }
  }
}

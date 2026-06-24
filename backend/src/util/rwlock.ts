// RWLock — writer-preference reader/writer lock.
//
// Used by the maintenance gate (db/backup.ts): backup + restore acquire
// WRITE (exclusive — DB handle is closed/replaced); the monitoring scheduler
// acquires READ (shared — multiple ticks may interleave). Writer preference
// keeps a steady stream of scheduler ticks from starving the daily backup:
// once a writer is queued, new readers wait until the writer drains.
//
// Invariants:
//   - At most one of { activeReaders > 0, writerActive } at any time
//   - A queued writer cannot be jumped by a later-queued reader
//   - A throw inside the body still releases the slot (chain self-heals,
//     matching the old withMaintenanceLock behavior)
//
// FIFO across mixed read/write requests; bursts of consecutive readers at
// the queue head all release together so concurrent ticks remain parallel.

type Waiter = { kind: "read"; resolve: () => void } | { kind: "write"; resolve: () => void };

export class RWLock {
  private activeReaders = 0;
  private writerActive = false;
  private readonly queue: Waiter[] = [];

  async withRead<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquireRead();
    try {
      return await fn();
    } finally {
      this.releaseRead();
    }
  }

  async withWrite<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquireWrite();
    try {
      return await fn();
    } finally {
      this.releaseWrite();
    }
  }

  private async acquireRead(): Promise<void> {
    // Writer preference: if a writer is active OR queued, the new reader
    // must wait. Without this check, a steady stream of readers could
    // indefinitely starve a pending writer.
    if (this.writerActive || this.hasQueuedWriter()) {
      await new Promise<void>((resolve) => {
        this.queue.push({ kind: "read", resolve });
      });
      // Tier 3 #14: drain() bumped activeReaders synchronously BEFORE it
      // resolved us, so we must not double-count here. The fast path below
      // is the only spot that increments — preserving the invariant that
      // counter mutations are atomic with the lock-state check.
      return;
    }
    this.activeReaders++;
  }

  private async acquireWrite(): Promise<void> {
    if (this.writerActive || this.activeReaders > 0) {
      await new Promise<void>((resolve) => {
        this.queue.push({ kind: "write", resolve });
      });
      // Tier 3 #14: drain() set writerActive=true synchronously BEFORE it
      // resolved us — see acquireRead for the rationale. Setting it again
      // here would still be correct but obscures the invariant.
      return;
    }
    this.writerActive = true;
  }

  private releaseRead(): void {
    this.activeReaders--;
    this.drain();
  }

  private releaseWrite(): void {
    this.writerActive = false;
    this.drain();
  }

  private hasQueuedWriter(): boolean {
    for (const w of this.queue) {
      if (w.kind === "write") return true;
    }
    return false;
  }

  private drain(): void {
    if (this.writerActive || this.activeReaders > 0) return;
    if (this.queue.length === 0) return;

    // Head of queue decides the next regime:
    //   - writer at head → wake exactly that one writer (then it acquires)
    //   - reader at head → wake every consecutive reader prefix; stop at
    //     the first writer so writer preference holds for whatever queues next
    //
    // Tier 3 #14: state mutation is performed synchronously HERE, before
    // any resolve() fires. A woken waiter's continuation runs in a later
    // microtask; if we left the counters/flags untouched, that microtask
    // window would expose `writerActive=false, queue empty, activeReaders=0`
    // to any synchronous observer — i.e. a freshly-arriving acquireRead
    // would slip past mutual exclusion. Setting state first closes the gap.
    const head = this.queue[0];
    if (!head) return;
    if (head.kind === "write") {
      this.writerActive = true;
      const writer = this.queue.shift();
      writer?.resolve();
      return;
    }
    // Reader prefix: collect everyone first, bump the counter once, then
    // resolve. Doing it in two passes keeps the counter consistent for any
    // probe that runs between consecutive resolves.
    const woken: Waiter[] = [];
    while (true) {
      const reader = this.queue[0];
      if (!reader || reader.kind !== "read") break;
      this.queue.shift();
      woken.push(reader);
    }
    this.activeReaders += woken.length;
    for (const w of woken) w.resolve();
  }
}

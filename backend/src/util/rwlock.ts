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

type Waiter =
  | { kind: "read"; resolve: () => void }
  | { kind: "write"; resolve: () => void };

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
    }
    this.activeReaders++;
  }

  private async acquireWrite(): Promise<void> {
    if (this.writerActive || this.activeReaders > 0) {
      await new Promise<void>((resolve) => {
        this.queue.push({ kind: "write", resolve });
      });
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
    if (this.queue[0]!.kind === "write") {
      this.queue.shift()!.resolve();
      return;
    }
    while (this.queue.length > 0 && this.queue[0]!.kind === "read") {
      this.queue.shift()!.resolve();
    }
  }
}

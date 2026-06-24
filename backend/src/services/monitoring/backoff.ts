// Pure backoff math for the monitoring scheduler.
//
// Kept as a leaf module (no DB, no clock side effects, no SOAP) so the formula
// is testable in isolation and the scheduler can unit-test scheduling decisions
// without spinning up a real clock or DB.
//
// Semantics (locked C2 design):
//   failStreak === 0  → success path, nextRunAt = now + cadenceSec + jitterSec
//   failStreak >= 1   → error path,   backoffSec = min(60 * 2^failStreak, 3600)
//                                     nextRunAt = now + backoffSec + jitterSec
//
// failStreak is post-increment: first fail → 1 → 120s, second → 2 → 240s, …,
// capped at 3600s (1h). cadenceSec is intentionally ignored on the error path
// — recovery is the priority, a 24h cadence shouldn't lengthen the retry.

export interface BackoffInput {
  now: Date;
  cadenceSec: number;
  failStreak: number;
  jitterSec: number;
}

const MIN_BACKOFF_SEC = 60;
const MAX_BACKOFF_SEC = 3600;

export function computeNextRunAt(input: BackoffInput): Date {
  const { now, cadenceSec, failStreak, jitterSec } = input;

  if (failStreak < 0) {
    throw new Error(`computeNextRunAt: failStreak must be >= 0 (got ${failStreak})`);
  }
  if (cadenceSec < 0) {
    throw new Error(`computeNextRunAt: cadenceSec must be >= 0 (got ${cadenceSec})`);
  }
  if (jitterSec < 0) {
    throw new Error(`computeNextRunAt: jitterSec must be >= 0 (got ${jitterSec})`);
  }

  const delaySec =
    failStreak === 0
      ? cadenceSec + jitterSec
      : Math.min(MIN_BACKOFF_SEC * 2 ** failStreak, MAX_BACKOFF_SEC) + jitterSec;

  return new Date(now.getTime() + delaySec * 1000);
}

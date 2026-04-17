/**
 * Date interval utilities for batch SOAP pagination.
 * PortalJust returns max 1000 results per request.
 * Strategy: split date ranges into monthly intervals to get all results.
 */

export interface DateInterval {
  dataStart: string; // YYYY-MM-DD
  dataStop: string;  // YYYY-MM-DD
}

/**
 * Generate monthly intervals between two dates (inclusive).
 * E.g. 2025-01-01 to 2025-03-31 → 3 intervals (Jan, Feb, Mar)
 */
export function generateMonthlyIntervals(startDate: string, stopDate: string): DateInterval[] {
  const intervals: DateInterval[] = [];
  const start = new Date(startDate + "T00:00:00Z");
  const stop = new Date(stopDate + "T00:00:00Z");

  if (isNaN(start.getTime()) || isNaN(stop.getTime()) || start > stop) {
    return [];
  }

  let current = new Date(start);
  while (current <= stop) {
    const year = current.getUTCFullYear();
    const month = current.getUTCMonth();

    // Month start = max(current, first day of this month)
    const monthStart = new Date(Date.UTC(year, month, 1));
    const intervalStart = monthStart < start ? start : monthStart;

    // Month end = min(last day of month, stop)
    const lastDay = new Date(Date.UTC(year, month + 1, 0)); // day 0 of next month = last day of current
    const intervalStop = lastDay > stop ? stop : lastDay;

    intervals.push({
      dataStart: formatDate(intervalStart),
      dataStop: formatDate(intervalStop),
    });

    // Move to first day of next month
    current = new Date(Date.UTC(year, month + 1, 1));
  }

  return intervals;
}

/**
 * Split an interval in half (for when a month also returns 1000 results).
 * Returns two sub-intervals.
 */
export function splitInterval(interval: DateInterval): [DateInterval, DateInterval] {
  const start = new Date(interval.dataStart + "T00:00:00Z");
  const stop = new Date(interval.dataStop + "T00:00:00Z");
  const mid = new Date(start.getTime() + Math.floor((stop.getTime() - start.getTime()) / 2));

  const nextDay = new Date(mid.getTime() + 86400000); // mid + 1 day

  return [
    { dataStart: interval.dataStart, dataStop: formatDate(mid) },
    { dataStart: formatDate(nextDay), dataStop: interval.dataStop },
  ];
}

function formatDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Default date range for load-more: last 7 years from today.
 * Combined with parallelism N=3 in batchFetchDosare, even heavy queries
 * (Wizz Air-class with 1000 cap per month) finish within SSE_TIMEOUT_MS (~9 min).
 */
export function defaultDateRange(): { dataStart: string; dataStop: string } {
  const now = new Date();
  const stop = formatDate(now);
  const start = formatDate(new Date(Date.UTC(now.getUTCFullYear() - 7, now.getUTCMonth(), now.getUTCDate())));
  return { dataStart: start, dataStop: stop };
}

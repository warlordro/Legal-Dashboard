import type { MonitoringAlertRow } from "../../db/monitoringAlertsRepository.ts";
import { getEmailSettings } from "../../db/ownerEmailSettingsRepository.ts";
import { recordAudit } from "../../db/auditRepository.ts";
import { isMailerConfigured, sendAlertEmail } from "./mailer.ts";

// v2.10.1 #6: bounded concurrency on outbound SMTP dispatches. Without a cap,
// an alerts burst could spawn dozens of parallel sendMail() calls — most SMTP
// gateways throttle aggressively (Gmail = 100/day, Office365 = 30/min) so
// keeping ONE in flight at a time is the safest default. The queue is FIFO so
// older alerts don't starve under sustained load.
const MAX_CONCURRENT = 1;
let inFlight = 0;
const queue: Array<() => Promise<void>> = [];
// v2.10.1 #7: tracking set of pending tasks so gracefulShutdown can wait for
// the queue to drain before closing the DB. Includes both queued tasks and
// in-flight tasks. drainEmailDispatches() resolves when every promise in the
// set has settled.
const pending = new Set<Promise<void>>();

function pump(): void {
  while (inFlight < MAX_CONCURRENT && queue.length > 0) {
    const task = queue.shift();
    if (!task) continue;
    inFlight++;
    void task().finally(() => {
      inFlight--;
      pump();
    });
  }
}

function enqueue(task: () => Promise<void>): Promise<void> {
  const wrapped = new Promise<void>((resolve) => {
    queue.push(async () => {
      try {
        await task();
      } finally {
        resolve();
      }
    });
  });
  pending.add(wrapped);
  void wrapped.finally(() => pending.delete(wrapped));
  pump();
  return wrapped;
}

export async function drainEmailDispatches(timeoutMs = 10_000): Promise<void> {
  if (pending.size === 0) return;
  const all = Promise.allSettled([...pending]);
  const timeout = new Promise<"timeout">((resolve) => {
    setTimeout(() => resolve("timeout"), timeoutMs).unref?.();
  });
  const result = await Promise.race([all, timeout]);
  if (result === "timeout") {
    console.warn(`[email] drainEmailDispatches timeout after ${timeoutMs}ms (pending=${pending.size})`);
  }
}

export function pendingDispatchCountForTests(): number {
  return pending.size;
}

export async function dispatchAlertEmail(alert: MonitoringAlertRow): Promise<void> {
  // v2.10.1 #9: short-circuit before touching the DB when SMTP is disabled.
  // Cheaper than a SELECT per insertAlert and avoids spinning up a no-op
  // sendAlertEmail call that would just return mailer_disabled.
  if (!isMailerConfigured()) return;
  let settings: ReturnType<typeof getEmailSettings>;
  try {
    settings = getEmailSettings(alert.owner_id);
  } catch (err) {
    console.error("[email] dispatchAlertEmail repo lookup failed", err);
    return;
  }
  if (!settings || !settings.enabled || !settings.toAddress) return;

  await enqueue(async () => {
    try {
      const result = await sendAlertEmail(alert, settings);
      if (!result.ok) {
        // v2.10.1 #13: persist a denied/error audit so a silent SMTP outage
        // shows up on the audit trail. Synchronous DB write — recordAudit is
        // null-safe for the no-Context path.
        try {
          recordAudit(null, "email.dispatch.failed", {
            outcome: "error",
            ownerId: alert.owner_id,
            targetKind: "monitoring_alert",
            targetId: String(alert.id),
            detail: { reason: result.reason, alertKind: alert.kind },
          });
        } catch (auditErr) {
          console.error("[email] dispatchAlertEmail audit write failed", auditErr);
        }
      }
    } catch (err) {
      console.error("[email] dispatchAlertEmail isolated failure", err);
      try {
        recordAudit(null, "email.dispatch.failed", {
          outcome: "error",
          ownerId: alert.owner_id,
          targetKind: "monitoring_alert",
          targetId: String(alert.id),
          detail: {
            reason: "exception",
            message: err instanceof Error ? err.message : String(err),
          },
        });
      } catch (auditErr) {
        console.error("[email] dispatchAlertEmail audit write failed", auditErr);
      }
    }
  });
}

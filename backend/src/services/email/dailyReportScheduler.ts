import { recordAudit } from "../../db/auditRepository.ts";
import { listAlerts } from "../../db/monitoringAlertsRepository.ts";
import {
  listDailyReportCandidates,
  markDailyReportSent,
  type EmailSettings,
} from "../../db/ownerEmailSettingsRepository.ts";
import { isMailerConfigured, sendComposedEmail } from "./mailer.ts";
import { renderDailyReport } from "./dailyReportTemplate.ts";

// v2.13.0: scheduler care trimite per-owner un raport zilnic cu toate alertele
// din ziua precedenta (fara filtru de severitate). Ruleaza la 5 minute si
// trage doar pe owner-ul cu daily_report_enabled=1 a carui ultima trimitere
// nu a fost azi (`last_daily_report_sent_for != todayLocal`).
//
// Best-effort design (decisia user-ului 2026-05-04):
//  - Desktop: aplicatia poate fi inchisa la ora configurata. Nu facem catch-up
//    la urmatorul start — daca laptopul a stat offline la 09:00, raportul
//    pierde ziua aceea. Aceasta e marcata explicit in UI (EmailSettingsPanel).
//  - Web (cand e deployed): rezident 24/7, deci scheduler-ul fires la 09:00
//    server-time fara griji. DAILY_REPORT_HOUR=9 default; per-user config
//    deferata la versiuni viitoare cu UI explicit.
//
// `last_daily_report_sent_for` este single-shot per zi: marcam dupa SUCCES.
// Daca trimiterea esueaza, nu re-incercam la urmatorul tick (ar putea spam-ui
// SMTP-ul daca un host e jos toata dimineata) — auditul `email.daily_report.failed`
// surface esecul si user-ul vede in UI ca raportul nu a venit.

const TICK_INTERVAL_MS = 5 * 60 * 1000;
// Lista alertelor zilnice se citeste cu un cap larg ca sa nu pierdem o zi cu
// trafic spike. 1000/zi/owner depaseste cu mult orice volum normal in
// monitoring (~50-100/zi pe utilizator real); peste prag, digestul ar deveni
// inutilizabil ca format email oricum si user-ul ar folosi exportul XLSX/PDF.
const ALERT_FETCH_PAGE_SIZE = 1000;

// v2.20.8 — Batch 4.4: explicit retry backoff. Inainte era retry implicit (tick
// la 5min in toata fereastra de 1h = ~12 attempts), care spam-ueste SMTP-ul daca
// host-ul e jos toata dimineata. Acum 3 incercari maximum la 5/15/45 min, dupa
// care marcam ziua "sent" (ca evita re-fire la urmatorul tick) si auditul
// `email.daily_report.failed.exhausted` arata operatorului ca am renuntat.
// State-ul e in-memory (Map per owner+zi); pierderea la restart e OK — daca
// procesul a fost restartat, e probabil ca SMTP-ul a fost si el reparat.
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [5 * 60_000, 15 * 60_000, 45 * 60_000];

interface RetryState {
  date: string;
  attempts: number;
  nextAttemptAt: number;
}

const retryByOwner = new Map<string, RetryState>();

// Exportat pentru teste: reseteaza state-ul de retry intre teste.
export function _resetDailyReportRetryStateForTest(): void {
  retryByOwner.clear();
}

// Inregistreaza un esec si calculeaza fereastra de backoff pentru urmatorul tick.
// Daca attempts atinge MAX_RETRY_ATTEMPTS, urmatorul tick va executa ramura
// "exhausted" (markDailyReportSent + audit) si va sterge entry-ul.
function recordRetryFailure(ownerId: string, dateLocal: string, nowMs: number): void {
  const prev = retryByOwner.get(ownerId);
  const attempts = (prev && prev.date === dateLocal ? prev.attempts : 0) + 1;
  const backoffIdx = Math.min(attempts - 1, RETRY_BACKOFF_MS.length - 1);
  retryByOwner.set(ownerId, {
    date: dateLocal,
    attempts,
    nextAttemptAt: nowMs + RETRY_BACKOFF_MS[backoffIdx],
  });
}

interface SchedulerDeps {
  /** Returns the moment used for "is it the configured hour now?" decisions. */
  now: () => Date;
  /** YYYY-MM-DD format, server local timezone. Defaults to Date-derived. */
  formatLocalDate?: (d: Date) => string;
  /** Returns the configured local hour (0-23). Defaults to env DAILY_REPORT_HOUR. */
  reportHour?: () => number;
  /** SMTP gate. Defaults to isMailerConfigured(). */
  mailerConfigured?: () => boolean;
  /** Override for tests — replaces SMTP send. */
  send?: (
    to: string,
    composed: { subject: string; html: string; text: string }
  ) => Promise<{ ok: boolean; reason?: string }>;
}

function defaultFormatLocalDate(d: Date): string {
  // Server-local YYYY-MM-DD: same anchor used by the UI date pickers and
  // last_daily_report_sent_for column.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function defaultReportHour(): number {
  const raw = process.env.DAILY_REPORT_HOUR;
  if (!raw) return 9;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0 || n > 23) return 9;
  return n;
}

function localDayBoundsToUtcIso(dateLocal: string): { startIso: string; endIso: string } {
  // dateLocal is YYYY-MM-DD in server local timezone. Build the start/end
  // boundaries from local-component constructor so the UTC instants returned
  // match the actual local-day window.
  const [yStr, mStr, dStr] = dateLocal.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const end = new Date(y, m - 1, d, 23, 59, 59, 999);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function previousDay(dateLocal: string): string {
  const [yStr, mStr, dStr] = dateLocal.split("-");
  const d = new Date(Number(yStr), Number(mStr) - 1, Number(dStr));
  d.setDate(d.getDate() - 1);
  return defaultFormatLocalDate(d);
}

export interface DailyReportTickResult {
  fired: boolean;
  ownersConsidered: number;
  emailsSent: number;
  emailsSkippedNoAlerts: number;
  emailsFailed: number;
}

// One scheduler tick. Exported for tests so they can advance virtual time and
// assert on the result without spinning the real setInterval.
export async function runDailyReportTick(deps: SchedulerDeps): Promise<DailyReportTickResult> {
  const formatLocalDate = deps.formatLocalDate ?? defaultFormatLocalDate;
  const getHour = deps.reportHour ?? defaultReportHour;
  const mailerCheck = deps.mailerConfigured ?? isMailerConfigured;
  const send =
    deps.send ??
    (async (to, composed) => {
      const r = await sendComposedEmail(to, composed);
      return r.ok ? { ok: true } : { ok: false, reason: r.reason };
    });

  const now = deps.now();
  const configuredHour = getHour();
  const baseResult: DailyReportTickResult = {
    fired: false,
    ownersConsidered: 0,
    emailsSent: 0,
    emailsSkippedNoAlerts: 0,
    emailsFailed: 0,
  };

  if (now.getHours() !== configuredHour) return baseResult;
  if (!mailerCheck()) return { ...baseResult, fired: true };

  const todayLocal = formatLocalDate(now);
  const yesterdayLocal = previousDay(todayLocal);
  const { startIso, endIso } = localDayBoundsToUtcIso(yesterdayLocal);

  let candidates: EmailSettings[] = [];
  try {
    candidates = listDailyReportCandidates(todayLocal);
  } catch (err) {
    console.error("[daily-report] listDailyReportCandidates failed", err);
    return { ...baseResult, fired: true };
  }

  let sent = 0;
  let skippedNoAlerts = 0;
  let failed = 0;
  const nowMs = now.getTime();
  for (const owner of candidates) {
    if (!owner.enabled || !owner.toAddress) continue;

    // v2.20.8 — Batch 4.4: respecta backoff-ul. Daca state-ul curent indica
    // urmatoarea incercare in viitor, sarim — urmatorul tick (5min) va re-evalua.
    // Daca state-ul e pentru o zi anterioara, e stale → cleanup si continuam ca
    // attempt nou.
    const retry = retryByOwner.get(owner.ownerId);
    if (retry) {
      if (retry.date !== todayLocal) {
        retryByOwner.delete(owner.ownerId);
      } else if (retry.attempts >= MAX_RETRY_ATTEMPTS) {
        // Exhausted: marcheaza ziua sent pentru cleanup linistit (vezi markDailyReportSent
        // mai jos in zero-alerts path pentru rationament identic). Audit indica
        // explicit motivul ca operatorul sa nu se intrebe.
        try {
          markDailyReportSent(owner.ownerId, todayLocal);
        } catch (err) {
          console.error(`[daily-report] markDailyReportSent (retry-exhausted) failed for ${owner.ownerId}`, err);
        }
        try {
          recordAudit(null, "email.daily_report.failed", {
            outcome: "error",
            ownerId: owner.ownerId,
            targetKind: "owner_email_settings",
            targetId: owner.ownerId,
            detail: {
              reason: "retry_exhausted",
              attempts: retry.attempts,
              date: yesterdayLocal,
            },
          });
        } catch {
          /* audit best-effort */
        }
        retryByOwner.delete(owner.ownerId);
        continue;
      } else if (nowMs < retry.nextAttemptAt) {
        // Inca in fereastra de backoff — nu incerca acum.
        continue;
      }
    }

    let alerts: ReturnType<typeof listAlerts>["rows"];
    try {
      const list = listAlerts({
        ownerId: owner.ownerId,
        page: 1,
        pageSize: ALERT_FETCH_PAGE_SIZE,
        from: startIso,
        to: endIso,
        includeDismissed: true,
      });
      alerts = list.rows;
    } catch (err) {
      console.error(`[daily-report] listAlerts failed for owner ${owner.ownerId}`, err);
      failed++;
      recordRetryFailure(owner.ownerId, todayLocal, nowMs);
      try {
        recordAudit(null, "email.daily_report.failed", {
          outcome: "error",
          ownerId: owner.ownerId,
          targetKind: "owner_email_settings",
          targetId: owner.ownerId,
          detail: { reason: "fetch_failed", date: yesterdayLocal },
        });
      } catch {
        /* audit best-effort */
      }
      continue;
    }

    if (alerts.length === 0) {
      // Skipping the email keeps the inbox clean on quiet days. Still mark
      // the day as "sent" so the next tick (e.g. 09:05) doesn't re-evaluate
      // and so a late inserted alert at 09:30 doesn't suddenly trigger a
      // partial send for yesterday.
      retryByOwner.delete(owner.ownerId);
      try {
        markDailyReportSent(owner.ownerId, todayLocal);
      } catch (err) {
        console.error(`[daily-report] markDailyReportSent (zero-alert path) failed for ${owner.ownerId}`, err);
      }
      skippedNoAlerts++;
      continue;
    }

    const composed = renderDailyReport({
      reportDateLocal: yesterdayLocal,
      alerts,
    });

    try {
      const result = await send(owner.toAddress, {
        subject: composed.subject,
        html: composed.html,
        text: composed.text,
      });
      if (result.ok) {
        sent++;
        retryByOwner.delete(owner.ownerId);
        try {
          markDailyReportSent(owner.ownerId, todayLocal);
        } catch (err) {
          console.error(`[daily-report] markDailyReportSent failed for ${owner.ownerId}`, err);
        }
        try {
          recordAudit(null, "email.daily_report.sent", {
            outcome: "ok",
            ownerId: owner.ownerId,
            targetKind: "owner_email_settings",
            targetId: owner.ownerId,
            detail: {
              date: yesterdayLocal,
              alertCount: composed.rowCount,
            },
          });
        } catch {
          /* audit best-effort */
        }
      } else {
        failed++;
        recordRetryFailure(owner.ownerId, todayLocal, nowMs);
        try {
          recordAudit(null, "email.daily_report.failed", {
            outcome: "error",
            ownerId: owner.ownerId,
            targetKind: "owner_email_settings",
            targetId: owner.ownerId,
            detail: { reason: result.reason ?? "unknown", date: yesterdayLocal },
          });
        } catch {
          /* audit best-effort */
        }
      }
    } catch (err) {
      failed++;
      recordRetryFailure(owner.ownerId, todayLocal, nowMs);
      console.error(`[daily-report] send threw for owner ${owner.ownerId}`, err);
      try {
        recordAudit(null, "email.daily_report.failed", {
          outcome: "error",
          ownerId: owner.ownerId,
          targetKind: "owner_email_settings",
          targetId: owner.ownerId,
          detail: {
            reason: "exception",
            message: err instanceof Error ? err.message : String(err),
            date: yesterdayLocal,
          },
        });
      } catch {
        /* audit best-effort */
      }
    }
  }

  return {
    fired: true,
    ownersConsidered: candidates.length,
    emailsSent: sent,
    emailsSkippedNoAlerts: skippedNoAlerts,
    emailsFailed: failed,
  };
}

let interval: NodeJS.Timeout | null = null;
let inFlight: Promise<DailyReportTickResult> | null = null;

export function startDailyReportScheduler(): void {
  if (interval) return;
  const realDeps: SchedulerDeps = { now: () => new Date() };
  const safeTick = () => {
    if (inFlight) return;
    inFlight = runDailyReportTick(realDeps)
      .catch((err) => {
        console.error("[daily-report] tick threw", err);
        return {
          fired: false,
          ownersConsidered: 0,
          emailsSent: 0,
          emailsSkippedNoAlerts: 0,
          emailsFailed: 0,
        } satisfies DailyReportTickResult;
      })
      .finally(() => {
        inFlight = null;
      });
  };
  interval = setInterval(safeTick, TICK_INTERVAL_MS);
  interval.unref?.();
  console.log("[daily-report] scheduler started (5min tick)");
}

export async function stopDailyReportScheduler(): Promise<void> {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
  if (inFlight) {
    try {
      await inFlight;
    } catch {
      /* swallowed inside safeTick */
    }
  }
}

// v2.32.0 Budget soft warning dispatcher. Invocat dupa orice ai_usage write
// pentru a verifica pragul 80% pe (user, quotaFeature) si a declansa episode
// notification (email + banner). Folosit de aiUsage.recordAiUsageSafely sub
// queueMicrotask, deci NU e pe hot-path-ul SSE.
//
// State machine (vezi budget_notifications):
//   pct >= 80 && episode inactiv  -> fire (banner + email)
//   pct >= 80 && episode activ    -> no-op
//   pct < 80  && episode activ    -> clear (banner auto-clear)
//   pct < 80  && episode inactiv  -> no-op
//
// Quota feature mapping: AI usage logheaza feature "dosar_summary" /
// "dosar_multi_analyst" / "dosar_multi_judge"; quota e pe "ai.single" /
// "ai.multi". Mapping in `quotaFeatureOf` mai jos.

import { earliestAiUsageTsInWindow, sumAiUsageMilliInWindow } from "../db/aiUsageRepository.ts";
import { recordAudit } from "../db/auditRepository.ts";
import {
  clearWarning,
  fireWarning,
  getState,
  incrementEmailAttempt,
  isWarningActive,
  markEmailSent,
} from "../db/budgetNotificationsRepository.ts";
import { getEmailSettings } from "../db/ownerEmailSettingsRepository.ts";
import { getUserById } from "../db/userRepository.ts";
import { sumActiveExtraMilli } from "../db/userQuotaGrantsRepository.ts";
import { type QuotaPeriod, getOverride } from "../db/userQuotaRepository.ts";
import { sendComposedEmail } from "./email/mailer.ts";

// v2.42.0: limita AI e un POOL unic ("ai") peste toate analizele — warning-ul
// urmareste acelasi pool ca quotaGuard, nu doua praguri separate.
export type QuotaFeature = "ai";

const WARNING_THRESHOLD_PCT = 80;
const EMAIL_COOLDOWN_SECONDS = 3600;
const PERIOD_SECONDS: Record<QuotaPeriod, number> = {
  day: 86_400,
  week: 604_800,
  month: 2_592_000,
};

// AI usage feature codes -> quota feature. NULL = nu trigger warning (feature
// fara cap, e.g. monitoring runs nu pe quota AI).
export function quotaFeatureOf(usageFeature: string): QuotaFeature | null {
  if (
    usageFeature === "dosar_summary" ||
    usageFeature === "ai.single" ||
    usageFeature === "dosar_multi_analyst" ||
    usageFeature === "dosar_multi_judge" ||
    usageFeature === "ai.multi" ||
    usageFeature === "ai"
  ) {
    return "ai";
  }
  return null;
}

// Default cap din env (mirror din quotaGuard). NULL = pass-through pentru
// useri fara override + fara env => fara warning de calculat.
function readDefaultQuotaMilli(): number | null {
  const raw = process.env.LEGAL_DASHBOARD_DEFAULT_AI_QUOTA_MILLI;
  if (raw === undefined || raw === "") return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) return null;
  return parsed;
}

export interface CheckBudgetWarningOptions {
  // Inject sender pentru teste. Default = sendComposedEmail.
  sendEmail?: typeof sendComposedEmail;
  // Inject now pentru teste deterministe.
  now?: Date;
}

export interface CheckBudgetWarningResult {
  // 'fired' = episode nou armat. 'cleared' = inchis. 'noop' = nimic schimbat.
  // 'skipped' = nu se aplica (NULL limit, feature necunoscut, etc).
  state: "fired" | "cleared" | "noop" | "skipped";
  reason?: string;
  pct?: number;
  emailDispatched?: boolean;
}

export async function checkBudgetWarning(
  ownerId: string,
  usageFeature: string,
  options: CheckBudgetWarningOptions = {}
): Promise<CheckBudgetWarningResult> {
  const quotaFeature = quotaFeatureOf(usageFeature);
  if (!quotaFeature) return { state: "skipped", reason: "not_quota_feature" };

  const override = getOverride(ownerId, quotaFeature);
  const defaultMilli = readDefaultQuotaMilli();
  const baseLimit = override ? override.limit_usd_milli : defaultMilli;
  // Unlimited (NULL) sau lipsa de cap => fara warning posibil. Clear episode
  // anterior daca a fost activ (admin a setat NULL ca sa scoata banner-ul).
  if (baseLimit === null) {
    const wasActive = isWarningActive(ownerId, quotaFeature, WARNING_THRESHOLD_PCT);
    if (wasActive) {
      clearWarning(ownerId, quotaFeature, WARNING_THRESHOLD_PCT);
      return { state: "cleared", reason: "limit_removed" };
    }
    return { state: "skipped", reason: "unlimited" };
  }

  const period: QuotaPeriod = override?.period ?? "day";
  const extraFromGrants = sumActiveExtraMilli(ownerId, quotaFeature);
  const effectiveLimit = baseLimit + extraFromGrants;
  if (effectiveLimit <= 0) return { state: "skipped", reason: "zero_limit" };

  const usedMilli = sumAiUsageMilliInWindow(ownerId, quotaFeature, PERIOD_SECONDS[period]);
  const pct = (usedMilli / effectiveLimit) * 100;

  if (pct < WARNING_THRESHOLD_PCT) {
    const cleared = clearWarning(ownerId, quotaFeature, WARNING_THRESHOLD_PCT);
    return cleared ? { state: "cleared", pct } : { state: "noop", pct };
  }

  // pct >= 80%: fire daca nu e deja activ.
  const fired = fireWarning({ userId: ownerId, feature: quotaFeature, thresholdPct: WARNING_THRESHOLD_PCT });
  if (!fired) {
    return { state: "noop", pct };
  }

  recordAudit(null, "budget.warning.fired", {
    ownerId,
    actorId: "system",
    detail: {
      feature: quotaFeature,
      thresholdPct: WARNING_THRESHOLD_PCT,
      pct: Math.round(pct),
      usedMilli,
      effectiveLimit,
      period,
    },
  });

  const now = options.now ?? new Date();
  const currentState = getState(ownerId, quotaFeature, WARNING_THRESHOLD_PCT);
  const lastAttemptMs = currentState?.last_email_attempted_at
    ? Date.parse(currentState.last_email_attempted_at)
    : Number.NaN;
  if (!Number.isNaN(lastAttemptMs) && now.getTime() - lastAttemptMs < EMAIL_COOLDOWN_SECONDS * 1000) {
    return { state: "fired", pct, emailDispatched: false };
  }

  incrementEmailAttempt(ownerId, quotaFeature, WARNING_THRESHOLD_PCT);

  // Episode tocmai aprins -> dispatch email best-effort. Failure-ul nu
  // afecteaza banner-ul (state-ul ramane fired, email_sent_at ramane NULL).
  const emailDispatched = await dispatchWarningEmail(
    ownerId,
    quotaFeature,
    { usedMilli, effectiveLimit, period, pct },
    options.sendEmail ?? sendComposedEmail,
    now
  );

  return { state: "fired", pct, emailDispatched };
}

export async function checkBudgetWarningRetry(
  ownerId: string,
  usageFeature: string,
  thresholdPct: number,
  options: CheckBudgetWarningOptions = {}
): Promise<CheckBudgetWarningResult> {
  const quotaFeature = quotaFeatureOf(usageFeature);
  if (!quotaFeature) return { state: "skipped", reason: "not_quota_feature" };
  if (thresholdPct !== WARNING_THRESHOLD_PCT) return { state: "skipped", reason: "unsupported_threshold" };

  const state = getState(ownerId, quotaFeature, thresholdPct);
  if (!state || state.fired_at === null || state.cleared_at !== null || state.email_sent_at !== null) {
    return { state: "noop" };
  }

  const override = getOverride(ownerId, quotaFeature);
  const defaultMilli = readDefaultQuotaMilli();
  const baseLimit = override ? override.limit_usd_milli : defaultMilli;
  if (baseLimit === null) return { state: "skipped", reason: "unlimited" };

  const period: QuotaPeriod = override?.period ?? "day";
  const extraFromGrants = sumActiveExtraMilli(ownerId, quotaFeature);
  const effectiveLimit = baseLimit + extraFromGrants;
  if (effectiveLimit <= 0) return { state: "skipped", reason: "zero_limit" };

  const usedMilli = sumAiUsageMilliInWindow(ownerId, quotaFeature, PERIOD_SECONDS[period]);
  const pct = (usedMilli / effectiveLimit) * 100;
  if (pct < WARNING_THRESHOLD_PCT) {
    clearWarning(ownerId, quotaFeature, thresholdPct);
    return { state: "cleared", pct };
  }

  incrementEmailAttempt(ownerId, quotaFeature, thresholdPct);
  const emailDispatched = await dispatchWarningEmail(
    ownerId,
    quotaFeature,
    { usedMilli, effectiveLimit, period, pct },
    options.sendEmail ?? sendComposedEmail,
    options.now ?? new Date()
  );
  return { state: "noop", pct, emailDispatched };
}

async function dispatchWarningEmail(
  ownerId: string,
  quotaFeature: QuotaFeature,
  context: { usedMilli: number; effectiveLimit: number; period: QuotaPeriod; pct: number },
  sender: typeof sendComposedEmail,
  now: Date
): Promise<boolean> {
  const settings = getEmailSettings(ownerId);
  if (!settings || !settings.enabled || !settings.toAddress) return false;

  // Severity gate: warning este "warning"; daca user-ul a setat "critical",
  // skip dispatch. Banner-ul ramane vizibil indiferent.
  if (settings.minSeverity === "critical") return false;

  const user = getUserById(ownerId);
  const displayName = user?.display_name || user?.email || ownerId;
  const usedUsd = (context.usedMilli / 1000).toFixed(2);
  const limitUsd = (context.effectiveLimit / 1000).toFixed(2);
  const pctRounded = Math.round(context.pct);
  const earliest = earliestAiUsageTsInWindow(ownerId, quotaFeature, PERIOD_SECONDS[context.period]);
  const windowReset = earliest
    ? new Date(Date.parse(earliest) + PERIOD_SECONDS[context.period] * 1000).toISOString()
    : null;

  const subject = `[Legal Dashboard] ${pctRounded}% din bugetul AI consumat`;
  const text = [
    `Salut ${displayName},`,
    "",
    `Bugetul tau AI (perioada: ${context.period}) este la ${pctRounded}%.`,
    `Consum curent: $${usedUsd} din $${limitUsd}.`,
    windowReset ? `Fereastra se reseteaza in jur de: ${windowReset}.` : "",
    "",
    "Cand atingi 100%, requesturile noi vor primi 429 (Quota Exceeded). Daca ai nevoie de buget aditional, contacteaza administratorul.",
    "",
    "Acest mesaj a fost trimis automat. Nu raspunde la el.",
    `Trimis: ${now.toISOString()}`,
  ]
    .filter(Boolean)
    .join("\n");
  const html = `
    <h2>Buget la ${pctRounded}%</h2>
    <p>Salut ${escapeHtml(displayName)},</p>
    <p>Bugetul tau <strong>AI</strong> (perioada: ${context.period}) a depasit pragul de 80%.</p>
    <ul>
      <li>Consum curent: <strong>$${usedUsd}</strong> din $${limitUsd}</li>
      <li>Procent: <strong>${pctRounded}%</strong></li>
      ${windowReset ? `<li>Fereastra se reseteaza in jur de: ${windowReset}</li>` : ""}
    </ul>
    <p>Cand atingi 100%, requesturile noi vor primi 429 (Quota Exceeded). Daca ai nevoie de buget aditional, contacteaza administratorul.</p>
    <p style="color: #888; font-size: 12px;">Trimis automat la ${now.toISOString()}.</p>
  `.trim();

  try {
    const res = await sender(settings.toAddress, { subject, html, text });
    if (res.ok) {
      markEmailSent(ownerId, quotaFeature, WARNING_THRESHOLD_PCT);
      return true;
    }
    console.warn(
      JSON.stringify({
        action: "budget_warning.email_failed",
        owner_id: ownerId,
        feature: quotaFeature,
        reason: res.reason,
        ts: now.toISOString(),
      })
    );
    return false;
  } catch (err) {
    console.error("[budget_warning] email dispatch threw", {
      ownerId,
      feature: quotaFeature,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

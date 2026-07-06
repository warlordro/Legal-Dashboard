import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { recordAudit } from "../db/auditRepository.ts";
import { sumAiUsageMilliInWindow, sumAiUsageMilliToday } from "../db/aiUsageRepository.ts";
import { getState as getBudgetWarningState } from "../db/budgetNotificationsRepository.ts";
import { getLatest as getLatestFxRate } from "../db/fxRatesRepository.ts";
import {
  defaultEmailSettingsFor,
  getEmailSettings,
  upsertEmailSettings,
  type EmailSettings,
} from "../db/ownerEmailSettingsRepository.ts";
import { getTenantKeys } from "../db/tenantKeysRepository.ts";
import { getUserById } from "../db/userRepository.ts";
import { sumActiveExtraMilli } from "../db/userQuotaGrantsRepository.ts";
import { type QuotaPeriod, listOverridesForUser } from "../db/userQuotaRepository.ts";
import type { QuotaFeature } from "../middleware/quotaGuard.ts";
import { getAuthMode } from "../auth/config.ts";
import { getOwnerId } from "../middleware/owner.ts";
import { isMailerConfigured, sendTestEmail } from "../services/email/mailer.ts";
import { buildEmailSettingsAuditDetail } from "../util/auditSanitize.ts";
import { fail, ok } from "../util/envelope.ts";

const PERIOD_SECONDS: Record<QuotaPeriod, number> = {
  day: 86_400,
  week: 604_800,
  month: 2_592_000,
};

// D14 fail-closed: dupa 48h fara update consideram rate-ul stale; UI afiseaza
// "EUR indisponibil" in loc sa randeze un numar potential nefolositor.
const FX_STALE_THRESHOLD_HOURS = 48;

// GET /api/v1/me — returns the current user's profile (id, email, role, status,
// displayName). Frontend uses this to decide whether to render the Admin
// sidebar section. Until PR-9 wires real auth, getOwnerId returns 'local' and
// the seeded `users.local` row is what comes back; PR-9 swaps this for the
// JWT-derived user id.

export const meRouter = new Hono();

const ME_BODY_LIMIT = 4096;
const limitMeBody = bodyLimit({
  maxSize: ME_BODY_LIMIT,
  onError: (c) => c.json(fail("payload_too_large", "Payload prea mare", c), 413),
});

// v2.10.1 #1: minSeverity ramane optional in body — clientii care nu il trimit
// (panoul curent EmailSettingsPanel nu il editeaza) nu mai sufera silent
// overwrite peste valoarea stocata. Cand lipseste, handler-ul preia valoarea
// existenta sau cade pe default-ul repository-ului.
// v2.13.0: dailyReportEnabled adaugat ca optional ca PUT-urile vechi (UI inca
// nedeployed) sa nu reseteze flag-ul; cand lipseste, handler-ul preia valoarea
// existenta sau cade pe `false`.
const EmailSettingsBodySchema = z
  .object({
    enabled: z.boolean(),
    toAddress: z.string().trim().email().max(320).nullable(),
    minSeverity: z.enum(["info", "warning", "critical"]).optional(),
    dailyReportEnabled: z.boolean().optional(),
  })
  .strict();

function toEmailSettingsDto(settings: EmailSettings) {
  return {
    ...settings,
    mailerConfigured: isMailerConfigured(),
  };
}

function defaultEmailSettingsForUser(ownerId: string): EmailSettings {
  const base = defaultEmailSettingsFor(ownerId);
  const user = getUserById(ownerId);
  const email = user?.email ?? "";
  if (email && email !== "local@desktop" && email.includes("@")) {
    return { ...base, toAddress: email };
  }
  return base;
}

meRouter.get("/", (c) => {
  const userId = getOwnerId(c);
  const user = getUserById(userId);
  if (user === null) {
    return c.json(fail("unauthorized", "Utilizator inexistent", c), 401);
  }
  return c.json(
    ok(
      {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role,
        status: user.status,
        createdAt: user.created_at,
        lastLoginAt: user.last_login_at,
      },
      c
    ),
    200
  );
});

meRouter.get("/key-status", (c) => {
  const authMode = getAuthMode();
  if (authMode !== "web") {
    return c.json(
      ok(
        {
          authMode,
          tenantKeysConfigured: {
            anthropic: false,
            openai: false,
            google: false,
            openrouter: false,
            captcha: false,
          },
        },
        c
      ),
      200
    );
  }
  const keys = getTenantKeys();
  const captchaKey = keys.captchaProvider === "capsolver" ? keys.capsolver : keys.twocaptcha;
  return c.json(
    ok(
      {
        authMode,
        tenantKeysConfigured: {
          anthropic: keys.anthropic.length > 0,
          openai: keys.openai.length > 0,
          google: keys.google.length > 0,
          openrouter: keys.openrouter.length > 0,
          captcha: captchaKey.length > 0,
        },
      },
      c
    ),
    200
  );
});

meRouter.get("/budget", (c) => {
  const ownerId = getOwnerId(c);
  // v2.32.0: response include period (day/week/month rolling), baseLimit,
  // extraFromGrants, effectiveLimit (base + grants), usedMilli per rolling
  // window, si fxRate (USD->EUR) cu staleness flag. limitMilli ramane in
  // raspuns pentru clientii vechi (= effectiveLimit cand exista override,
  // null cand e unlimited sau lipsa).
  // v2.42.0 (5.2): pool AI unic — bugetul se raporteaza pe "ai" (suma acopera
  // toate feature-urile AI istorice prin aliases), plus orice override extra
  // (ex. captcha.rnpm sau randuri legacy ramase).
  const overrides = listOverridesForUser(ownerId);
  const overrideByFeature = new Map(overrides.map((row) => [row.feature, row]));
  const features = Array.from(new Set(["ai", ...overrideByFeature.keys()])).sort();
  const fx = getLatestFxRate("USD/EUR");
  const fxStale =
    fx === null ? true : Date.now() - Date.parse(`${fx.rate_date}T00:00:00Z`) > FX_STALE_THRESHOLD_HOURS * 3_600_000;

  return c.json(
    ok(
      {
        items: features.map((feature) => {
          const override = overrideByFeature.get(feature) ?? null;
          const period: QuotaPeriod = override?.period ?? "day";
          const baseLimit = override?.limit_usd_milli ?? null;
          const extraFromGrants = sumActiveExtraMilli(ownerId, feature);
          const effectiveLimit = baseLimit === null ? null : baseLimit + extraFromGrants;
          const usedMilli =
            period === "day"
              ? sumAiUsageMilliToday(ownerId, feature)
              : sumAiUsageMilliInWindow(ownerId, feature, PERIOD_SECONDS[period]);
          return {
            feature,
            period,
            usedMilli,
            baseLimitMilli: baseLimit,
            extraFromGrantsMilli: extraFromGrants,
            effectiveLimitMilli: effectiveLimit,
            // Legacy alias for old clients — equals effectiveLimitMilli.
            limitMilli: effectiveLimit,
          };
        }),
        fx:
          fx === null
            ? { pair: "USD/EUR", rate: null, rateDate: null, stale: true }
            : { pair: fx.pair, rate: fx.rate, rateDate: fx.rate_date, stale: fxStale },
      },
      c
    ),
    200
  );
});

// v2.32.0: banner pentru avertizarea de buget la 80%. UI il poll-uieste (sau
// re-cere dupa orice request AI) si afiseaza banner pentru fiecare entry.
// State e per (user, feature, threshold_pct=80) — vezi budget_notifications.
meRouter.get("/budget-warnings", (c) => {
  const ownerId = getOwnerId(c);
  // v2.42.0 (5.2): un singur episod de warning, pe pool-ul "ai".
  const features: QuotaFeature[] = ["ai"];
  const items = features
    .map((feature) => {
      const state = getBudgetWarningState(ownerId, feature, 80);
      if (state === null) return null;
      if (state.fired_at === null || state.cleared_at !== null) return null;
      return {
        feature,
        thresholdPct: state.threshold_pct,
        firedAt: state.fired_at,
        aboveSince: state.above_threshold_since,
        emailSentAt: state.email_sent_at,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return c.json(ok({ items }, c), 200);
});

meRouter.get("/fx/usd-eur", (c) => {
  const fx = getLatestFxRate("USD/EUR");
  if (fx === null) {
    return c.json(ok({ pair: "USD/EUR", rate: null, rateDate: null, stale: true }, c), 200);
  }
  const stale = Date.now() - Date.parse(`${fx.rate_date}T00:00:00Z`) > FX_STALE_THRESHOLD_HOURS * 3_600_000;
  return c.json(ok({ pair: fx.pair, rate: fx.rate, rateDate: fx.rate_date, stale }, c), 200);
});

meRouter.get("/email-settings", (c) => {
  const ownerId = getOwnerId(c);
  const settings = getEmailSettings(ownerId) ?? defaultEmailSettingsForUser(ownerId);
  return c.json(ok(toEmailSettingsDto(settings), c), 200);
});

meRouter.put("/email-settings", limitMeBody, async (c) => {
  const ownerId = getOwnerId(c);
  const body = await c.req.json().catch(() => null);
  const parsed = EmailSettingsBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(fail("invalid_body", "Body invalid", c, parsed.error.issues), 400);
  }
  if (parsed.data.enabled && !parsed.data.toAddress) {
    return c.json(fail("missing_to_address", "Adresa email este obligatorie cand notificarile sunt active", c), 400);
  }

  const before = getEmailSettings(ownerId);
  // v2.10.1 #1: preserve stored minSeverity if the caller didn't send it.
  const minSeverity = parsed.data.minSeverity ?? before?.minSeverity ?? "info";
  // v2.13.0: same treatment for dailyReportEnabled — preserve when omitted.
  const dailyReportEnabled = parsed.data.dailyReportEnabled ?? before?.dailyReportEnabled ?? false;
  const after = upsertEmailSettings(ownerId, {
    enabled: parsed.data.enabled,
    toAddress: parsed.data.toAddress,
    minSeverity,
    dailyReportEnabled,
  });
  // v2.34.0 P0-1: NU serializa `before/after` raw — `toAddress` plaintext in
  // audit_log e PII GDPR. Folosim whitelist explicit cu hash + last4 pentru
  // email; restul campurilor (boolean/enum) sunt nepericuloase.
  recordAudit(c, "me.email_settings.update", {
    targetKind: "owner_email_settings",
    targetId: ownerId,
    detail: buildEmailSettingsAuditDetail(before, after),
  });
  return c.json(ok(toEmailSettingsDto(after), c), 200);
});

// v2.10.1 #3: per-owner cooldown for /email-settings/test. SMTP test sends
// hit the real upstream — we don't want a stuck UI button or a malicious
// caller looping the endpoint to dispatch dozens of test emails per minute.
// 60 s is long enough to discourage abuse and short enough that a normal user
// retry after a typo isn't blocked.
const TEST_COOLDOWN_MS = 60_000;
const lastTestSendByOwner = new Map<string, number>();
export function resetEmailTestCooldownForTests(): void {
  lastTestSendByOwner.clear();
}
export function emailTestCooldownHasOwnerForTests(owner: string): boolean {
  return lastTestSendByOwner.has(owner);
}

// Entry-urile mai vechi decat cooldown-ul nu mai influenteaza nicio decizie —
// le stergem la fiecare acces ca Map-ul sa nu creasca nelimitat in web mode.
function pruneExpiredTestCooldowns(now: number): void {
  for (const [owner, ts] of lastTestSendByOwner) {
    if (now - ts > TEST_COOLDOWN_MS) lastTestSendByOwner.delete(owner);
  }
}

meRouter.post("/email-settings/test", async (c) => {
  const ownerId = getOwnerId(c);
  const settings = getEmailSettings(ownerId);
  if (!settings?.toAddress) {
    recordAudit(c, "me.email_settings.test", {
      outcome: "error",
      targetKind: "owner_email_settings",
      targetId: ownerId,
      detail: { reason: "missing_to_address" },
    });
    return c.json(fail("missing_to_address", "Salveaza intai o adresa email", c), 400);
  }
  if (!isMailerConfigured()) {
    recordAudit(c, "me.email_settings.test", {
      outcome: "error",
      targetKind: "owner_email_settings",
      targetId: ownerId,
      detail: { reason: "mailer_disabled" },
    });
    return c.json(fail("mailer_disabled", "SMTP_* nu este configurat", c), 503);
  }

  // v2.10.1 #3: per-owner cooldown.
  pruneExpiredTestCooldowns(Date.now());
  const now = Date.now();
  const last = lastTestSendByOwner.get(ownerId) ?? 0;
  const elapsed = now - last;
  if (elapsed < TEST_COOLDOWN_MS) {
    const retryAfterSec = Math.ceil((TEST_COOLDOWN_MS - elapsed) / 1000);
    recordAudit(c, "me.email_settings.test", {
      outcome: "denied",
      targetKind: "owner_email_settings",
      targetId: ownerId,
      detail: { reason: "cooldown", retryAfterSec },
    });
    c.header("Retry-After", String(retryAfterSec));
    return c.json(
      fail("cooldown", `Asteapta ${retryAfterSec}s inainte sa retrimiti email-ul de test`, c, { retryAfterSec }),
      429
    );
  }
  lastTestSendByOwner.set(ownerId, now);

  const result = await sendTestEmail(settings.toAddress);
  recordAudit(c, "me.email_settings.test", {
    outcome: result.ok ? "ok" : "error",
    targetKind: "owner_email_settings",
    targetId: ownerId,
    detail: result,
  });
  return c.json(ok(result, c), 200);
});

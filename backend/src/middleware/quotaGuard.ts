import type { Context, Next } from "hono";

import { getAuthMode } from "../auth/config.ts";
import {
  earliestAiUsageTsInWindow,
  insertAiUsageReservation,
  sumAiUsageMilliInWindow,
  type AiUsageProvider,
} from "../db/aiUsageRepository.ts";
import { getDb } from "../db/schema.ts";
import { sumActiveExtraMilli } from "../db/userQuotaGrantsRepository.ts";
import { type QuotaPeriod, getOverride } from "../db/userQuotaRepository.ts";
import { getOwnerId } from "./owner.ts";
import { ErrorCodes, fail } from "../util/envelope.ts";

declare module "hono" {
  interface ContextVariableMap {
    quotaFeature: QuotaFeature;
    quotaReservationId: number | null;
  }
}

export const QUOTA_FEATURES = ["ai.single", "ai.multi"] as const;
export type QuotaFeature = (typeof QUOTA_FEATURES)[number];

// v2.32.0 rolling window seconds per period. Locked in D15 — operatorul nu
// alege secundele, doar perioada (day/week/month). 24h/7d/30d.
const PERIOD_SECONDS: Record<QuotaPeriod, number> = {
  day: 86_400,
  week: 604_800,
  month: 2_592_000,
};

const FEATURE_ESTIMATED_COST_MILLI: Record<QuotaFeature, number> = {
  "ai.single": 2_000,
  "ai.multi": 8_000,
};

function estimatedCostMilli(feature: QuotaFeature): number {
  const rawMultiplier = process.env.LEGAL_DASHBOARD_QUOTA_ESTIMATE_MULTIPLIER;
  const multiplier =
    rawMultiplier === undefined || rawMultiplier === ""
      ? 1
      : Number.isFinite(Number(rawMultiplier)) && Number(rawMultiplier) > 0
        ? Number(rawMultiplier)
        : 1;
  return Math.ceil(FEATURE_ESTIMATED_COST_MILLI[feature] * multiplier);
}

// Default-deny floor for users without an explicit per-feature override.
// LEGAL_DASHBOARD_DEFAULT_AI_QUOTA_MILLI (integer milli-USD, daily) gives the
// tenant admin a safety net so a forgotten quota row cannot translate into
// unbounded spend on the tenant wallet. When the env is unset, behavior is
// unchanged (backward compatible: no override -> allow). When set to 0, every
// AI request without an override is blocked. On a per-request basis the guard
// also reads it once each call so operators can hot-swap via env reload.
// Multi-agent overshoot: this guard runs once per HTTP request; analyze-multi
// can spend up to (N_analysts + 1) * max_call_cost above the limit before the
// next request observes the new sum. PLAN §12 accepted tradeoff.
function readDefaultQuotaMilli(): number | null {
  const raw = process.env.LEGAL_DASHBOARD_DEFAULT_AI_QUOTA_MILLI;
  if (raw === undefined || raw === "") return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) return null;
  return parsed;
}

export function quotaGuard(feature: QuotaFeature) {
  return async (c: Context, next: Next) => {
    if (getAuthMode() !== "web") return next();
    c.set("quotaFeature", feature);
    const ownerId = getOwnerId(c);
    const override = getOverride(ownerId, feature);
    const defaultMilli = readDefaultQuotaMilli();

    // Period selection: override.period > default 'day'. Defaults sunt mereu
    // daily window — adminul nu poate seta period default fara override.
    const period: QuotaPeriod = override?.period ?? "day";
    const windowSeconds = PERIOD_SECONDS[period];

    // Base limit: override.limit_usd_milli (poate fi NULL = unlimited),
    // altfel defaultMilli (env). Daca NU exista nici override nici default,
    // pass-through (backward compatible).
    const baseLimit = override ? override.limit_usd_milli : defaultMilli;
    if (baseLimit === null) return next();

    // Grants active la baza limitei: append-only, fiecare grant adauga
    // extra_usd_milli pana la expirare. NU se aplica pe windowSeconds — sunt
    // grants pe FEATURE per user, valabile pana la expires_at.
    const extraFromGrants = sumActiveExtraMilli(ownerId, feature);
    const effectiveLimit = baseLimit + extraFromGrants;

    const usedMilli = sumAiUsageMilliInWindow(ownerId, feature, windowSeconds);
    // Explicit limit=0 always blocks (admin opt-in to deny-all). Otherwise we
    // block when spend equals or exceeds the cap. Grants nu pot "unblock" un
    // limit=0 fara grant: baseLimit=0+extra raman caz numeric normal.
    if (effectiveLimit === 0 || usedMilli >= effectiveLimit) {
      const retryAfter = retryAfterSecondsForWindow(ownerId, feature, windowSeconds);
      c.header("Retry-After", String(retryAfter));
      return c.json(
        fail(ErrorCodes.QUOTA_EXCEEDED, `Bugetul pentru ${feature} a fost depasit. Contacteaza adminul.`, c, {
          usedMilli,
          limitMilli: effectiveLimit,
          baseLimitMilli: baseLimit,
          extraFromGrantsMilli: extraFromGrants,
          period,
          feature,
          source: override ? "override" : "default",
        }),
        429
      );
    }

    return next();
  };
}

export function reserveQuotaBudget(
  c: Context,
  feature: QuotaFeature,
  provider: AiUsageProvider
): { ok: true; reservationId: number | null } | { ok: false; response: Response } {
  if (getAuthMode() !== "web") return { ok: true, reservationId: null };

  const ownerId = getOwnerId(c);
  const override = getOverride(ownerId, feature);
  const defaultMilli = readDefaultQuotaMilli();
  const period: QuotaPeriod = override?.period ?? "day";
  const windowSeconds = PERIOD_SECONDS[period];
  const baseLimit = override ? override.limit_usd_milli : defaultMilli;
  if (baseLimit === null) return { ok: true, reservationId: null };

  const extraFromGrants = sumActiveExtraMilli(ownerId, feature);
  const effectiveLimit = baseLimit + extraFromGrants;
  const estimatedCost = estimatedCostMilli(feature);
  let reservationId: number | null = null;
  let usedMilli = 0;
  let blocked = false;

  getDb()
    .transaction(() => {
      usedMilli = sumAiUsageMilliInWindow(ownerId, feature, windowSeconds);
      if (effectiveLimit === 0 || usedMilli + estimatedCost > effectiveLimit) {
        blocked = true;
        return;
      }
      reservationId = insertAiUsageReservation({
        ownerId,
        provider,
        feature,
        estimatedCostUsdMilli: estimatedCost,
        requestId: c.get("requestId") ?? null,
      });
    })
    .immediate();

  if (blocked) {
    const retryAfter = retryAfterSecondsForWindow(ownerId, feature, windowSeconds);
    c.header("Retry-After", String(retryAfter));
    return {
      ok: false,
      response: c.json(
        fail(ErrorCodes.QUOTA_EXCEEDED, `Bugetul pentru ${feature} a fost depasit. Contacteaza adminul.`, c, {
          usedMilli,
          reservedMilli: estimatedCost,
          limitMilli: effectiveLimit,
          baseLimitMilli: baseLimit,
          extraFromGrantsMilli: extraFromGrants,
          period,
          feature,
          source: override ? "override" : "default",
        }),
        429
      ),
    };
  }

  c.set("quotaReservationId", reservationId);
  return { ok: true, reservationId };
}

// Retry-After corect pentru rolling window: cea mai veche ts care contribuie
// la suma + windowSeconds = momentul cand iese din fereastra. Daca fereastra
// e goala (improbabil daca am ajuns la blocaj), fallback la windowSeconds.
function retryAfterSecondsForWindow(
  ownerId: string,
  feature: QuotaFeature,
  windowSeconds: number,
  now: Date = new Date()
): number {
  const earliest = earliestAiUsageTsInWindow(ownerId, feature, windowSeconds);
  if (!earliest) return windowSeconds;
  const earliestMs = Date.parse(earliest);
  if (Number.isNaN(earliestMs)) return windowSeconds;
  const releaseMs = earliestMs + windowSeconds * 1000;
  const deltaSec = Math.ceil((releaseMs - now.getTime()) / 1000);
  return Math.max(1, deltaSec);
}

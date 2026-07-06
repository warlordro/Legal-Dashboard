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

// v2.42.0 (5.2): pool AI UNIC. `user_quota_overrides` are un singur rand "ai"
// per user; TIPUL apelului (ai.single/ai.multi) ramane doar pe randurile de
// consum din `ai_usage` (cost estimat diferit), dar LIMITA se verifica mereu
// pe pool-ul "ai" — suma acopera toate feature-urile AI istorice prin
// quotaFeatureAliases("ai"). `captcha.rnpm` ramane cu semantica de count si se
// aplica in `withRnpmCaptchaGuards`.
export const QUOTA_FEATURES = ["ai", "captcha.rnpm"] as const;
export type QuotaFeature = (typeof QUOTA_FEATURES)[number];
// Tipul de apel AI — decide costul estimat si feature-ul randului de consum.
export type AiCallKind = "ai.single" | "ai.multi";
// Alias istoric: rutele AI il importa sub numele vechi.
export type AiQuotaFeature = AiCallKind;

const AI_POOL_FEATURE = "ai" as const;

// v2.32.0 rolling window seconds per period. Locked in D15 — operatorul nu
// alege secundele, doar perioada (day/week/month). 24h/7d/30d.
// Exportat: usage/overview (5.3) TREBUIE sa foloseasca exact aceleasi constante
// ca guard-ul, altfel cifrele din Consum divergeau de enforcement.
export const PERIOD_SECONDS: Record<QuotaPeriod, number> = {
  day: 86_400,
  week: 604_800,
  month: 2_592_000,
};

const FEATURE_ESTIMATED_COST_MILLI: Record<AiCallKind, number> = {
  "ai.single": 2_000,
  "ai.multi": 8_000,
};

function estimatedCostMilli(feature: AiCallKind): number {
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
// Exportat: baza grantului (admin.ts) si usage/overview (5.3) folosesc ACEEASI
// regula — altfel tenantii care merg doar pe env-ul default nu pot acorda
// granturi, iar cifrele din Consum mint.
let warnedInvalidDefaultQuota = false;
export function readDefaultQuotaMilli(): number | null {
  const raw = process.env.LEGAL_DASHBOARD_DEFAULT_AI_QUOTA_MILLI;
  if (raw === undefined || raw === "") return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    // Env INVALID = warn O DATA per proces + tratat ca nelimitat (ghid 12) —
    // nu silent: operatorul trebuie sa vada ca valoarea nu a fost aplicata.
    if (!warnedInvalidDefaultQuota) {
      warnedInvalidDefaultQuota = true;
      console.warn(
        `[quotaGuard] LEGAL_DASHBOARD_DEFAULT_AI_QUOTA_MILLI invalid ("${raw}") — tratat ca nelimitat (pass-through).`
      );
    }
    return null;
  }
  return parsed;
}

// v2.42.0 (5.2): guard-ul primeste TIPUL apelului (pentru randul de consum),
// dar limita se citeste/insumeaza mereu pe pool-ul "ai" — override "ai",
// granturi "ai", consum insumat pe TOATE feature-urile AI istorice (aliases).
export function quotaGuard(feature: AiCallKind) {
  return async (c: Context, next: Next) => {
    if (getAuthMode() !== "web") return next();
    c.set("quotaFeature", AI_POOL_FEATURE);
    const ownerId = getOwnerId(c);
    const override = getOverride(ownerId, AI_POOL_FEATURE);
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
    // grants pe pool per user, valabile pana la expires_at.
    const extraFromGrants = sumActiveExtraMilli(ownerId, AI_POOL_FEATURE);
    const effectiveLimit = baseLimit + extraFromGrants;

    const usedMilli = sumAiUsageMilliInWindow(ownerId, AI_POOL_FEATURE, windowSeconds);
    // Explicit limit=0 always blocks (admin opt-in to deny-all). Otherwise we
    // block when spend equals or exceeds the cap. Grants nu pot "unblock" un
    // limit=0 fara grant: baseLimit=0+extra raman caz numeric normal.
    if (effectiveLimit === 0 || usedMilli >= effectiveLimit) {
      const retryAfter = retryAfterSecondsForWindow(ownerId, windowSeconds);
      c.header("Retry-After", String(retryAfter));
      return c.json(
        fail(ErrorCodes.QUOTA_EXCEEDED, "Bugetul AI a fost depasit. Contacteaza adminul.", c, {
          usedMilli,
          limitMilli: effectiveLimit,
          baseLimitMilli: baseLimit,
          extraFromGrantsMilli: extraFromGrants,
          period,
          feature: AI_POOL_FEATURE,
          callKind: feature,
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
  feature: AiCallKind,
  provider: AiUsageProvider
): { ok: true; reservationId: number | null } | { ok: false; response: Response } {
  if (getAuthMode() !== "web") return { ok: true, reservationId: null };

  const ownerId = getOwnerId(c);
  const override = getOverride(ownerId, AI_POOL_FEATURE);
  const defaultMilli = readDefaultQuotaMilli();
  const period: QuotaPeriod = override?.period ?? "day";
  const windowSeconds = PERIOD_SECONDS[period];
  const baseLimit = override ? override.limit_usd_milli : defaultMilli;
  if (baseLimit === null) return { ok: true, reservationId: null };

  const extraFromGrants = sumActiveExtraMilli(ownerId, AI_POOL_FEATURE);
  const effectiveLimit = baseLimit + extraFromGrants;
  const estimatedCost = estimatedCostMilli(feature);
  let reservationId: number | null = null;
  let usedMilli = 0;
  let blocked = false;

  getDb()
    .transaction(() => {
      usedMilli = sumAiUsageMilliInWindow(ownerId, AI_POOL_FEATURE, windowSeconds);
      if (effectiveLimit === 0 || usedMilli + estimatedCost > effectiveLimit) {
        blocked = true;
        return;
      }
      // Randul de consum pastreaza TIPUL apelului (ai.single/ai.multi) —
      // pool-ul e doar politica de limita, nu granularitatea istoricului.
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
    const retryAfter = retryAfterSecondsForWindow(ownerId, windowSeconds);
    c.header("Retry-After", String(retryAfter));
    return {
      ok: false,
      response: c.json(
        fail(ErrorCodes.QUOTA_EXCEEDED, "Bugetul AI a fost depasit. Contacteaza adminul.", c, {
          usedMilli,
          reservedMilli: estimatedCost,
          limitMilli: effectiveLimit,
          baseLimitMilli: baseLimit,
          extraFromGrantsMilli: extraFromGrants,
          period,
          feature: AI_POOL_FEATURE,
          callKind: feature,
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
function retryAfterSecondsForWindow(ownerId: string, windowSeconds: number, now: Date = new Date()): number {
  const earliest = earliestAiUsageTsInWindow(ownerId, AI_POOL_FEATURE, windowSeconds);
  if (!earliest) return windowSeconds;
  const earliestMs = Date.parse(earliest);
  if (Number.isNaN(earliestMs)) return windowSeconds;
  const releaseMs = earliestMs + windowSeconds * 1000;
  const deltaSec = Math.ceil((releaseMs - now.getTime()) / 1000);
  return Math.max(1, deltaSec);
}

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

// v2.34.0 P1-4: `captcha.rnpm` is also valid for `user_quota_overrides` but
// uses count semantics (cap = numar de captcha-uri / fereastra), nu cost milli-USD.
// `quotaGuard()` ramane AI-only (cite ai_usage); captcha quota se aplica in
// `withRnpmCaptchaGuards` care citeste din `captcha_usage` cu acelasi tabel
// `user_quota_overrides`.
//
// v2.42.0 (decizie user): limita AI e UNICA — feature-ul de cota "ai" acopera
// toate analizele (single + multi) intr-un singur pool; migration 0041
// consolideaza override-urile/granturile legacy ai.single/ai.multi.
export const QUOTA_FEATURES = ["ai", "captcha.rnpm"] as const;
export type QuotaFeature = (typeof QUOTA_FEATURES)[number];
// Feature-ul CONCRET al apelului (ramane pe randurile ai_usage + costuri
// estimate diferite per tip de analiza); limita se verifica mereu pe "ai".
export type AiQuotaFeature = "ai.single" | "ai.multi";
const AI_POOL_FEATURE = "ai";

// v2.32.0 rolling window seconds per period. Locked in D15 — operatorul nu
// alege secundele, doar perioada (day/week/month). 24h/7d/30d.
// Exportat in v2.42.0 pentru GET /admin/usage/overview (aceeasi fereastra).
export const PERIOD_SECONDS: Record<QuotaPeriod, number> = {
  day: 86_400,
  week: 604_800,
  month: 2_592_000,
};

const FEATURE_ESTIMATED_COST_MILLI: Record<AiQuotaFeature, number> = {
  "ai.single": 2_000,
  "ai.multi": 8_000,
};

function estimatedCostMilli(feature: AiQuotaFeature): number {
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
// Exportat in v2.42.0: /admin/usage/overview aplica ACEEASI regula de limita
// implicita ca guard-ul, ca cifrele din UI sa coincida cu enforcement-ul.
let warnedInvalidDefaultQuota = false;
export function readDefaultQuotaMilli(): number | null {
  const raw = process.env.LEGAL_DASHBOARD_DEFAULT_AI_QUOTA_MILLI;
  if (raw === undefined || raw === "") return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    // Review-panel: un typo in env colapsa TACIT la "nelimitat" — operatorul
    // credea ca are plafon si nu avea. Warn o singura data per proces.
    if (!warnedInvalidDefaultQuota) {
      warnedInvalidDefaultQuota = true;
      console.warn(
        `[quota] LEGAL_DASHBOARD_DEFAULT_AI_QUOTA_MILLI="${raw}" invalid (astept integer >= 0) — tratat ca NELIMITAT`
      );
    }
    return null;
  }
  return parsed;
}

// Parametrul ramane in semnatura (documenteaza tipul apelului la ruta), dar
// limita se verifica mereu pe pool-ul unic "ai".
export function quotaGuard(_feature: AiQuotaFeature) {
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
    // grants pe FEATURE per user, valabile pana la expires_at.
    const extraFromGrants = sumActiveExtraMilli(ownerId, AI_POOL_FEATURE);
    const effectiveLimit = baseLimit + extraFromGrants;

    // Pool unic: consumul insumeaza TOATE apelurile AI (single + multi).
    const usedMilli = sumAiUsageMilliInWindow(ownerId, AI_POOL_FEATURE, windowSeconds);
    // Explicit limit=0 always blocks (admin opt-in to deny-all). Otherwise we
    // block when spend equals or exceeds the cap. Grants nu pot "unblock" un
    // limit=0 fara grant: baseLimit=0+extra raman caz numeric normal.
    if (effectiveLimit === 0 || usedMilli >= effectiveLimit) {
      const retryAfter = retryAfterSecondsForWindow(ownerId, AI_POOL_FEATURE, windowSeconds);
      c.header("Retry-After", String(retryAfter));
      return c.json(
        fail(ErrorCodes.QUOTA_EXCEEDED, "Bugetul AI a fost depasit. Contacteaza adminul.", c, {
          usedMilli,
          limitMilli: effectiveLimit,
          baseLimitMilli: baseLimit,
          extraFromGrantsMilli: extraFromGrants,
          period,
          feature: AI_POOL_FEATURE,
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
  feature: AiQuotaFeature,
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
    const retryAfter = retryAfterSecondsForWindow(ownerId, AI_POOL_FEATURE, windowSeconds);
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
  feature: string,
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

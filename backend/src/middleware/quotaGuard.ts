import type { Context, Next } from "hono";

import { getAuthMode } from "../auth/config.ts";
import { sumAiUsageMilliToday } from "../db/aiUsageRepository.ts";
import { getOverride } from "../db/userQuotaRepository.ts";
import { getOwnerId } from "./owner.ts";
import { ErrorCodes, fail } from "../util/envelope.ts";

export type QuotaFeature = "ai.single" | "ai.multi";

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
    const ownerId = getOwnerId(c);
    const override = getOverride(ownerId, feature);
    const defaultMilli = readDefaultQuotaMilli();
    const limitMilli = override ? override.daily_limit_usd_milli : defaultMilli;
    if (limitMilli === null) return next();

    const usedMilli = sumAiUsageMilliToday(ownerId, feature);
    // Explicit limit=0 always blocks (admin opt-in to deny-all). Otherwise we
    // block when today's spend equals or exceeds the cap.
    if (limitMilli === 0 || usedMilli >= limitMilli) {
      const retryAfter = secondsUntilUtcMidnight();
      c.header("Retry-After", String(retryAfter));
      return c.json(
        fail(ErrorCodes.QUOTA_EXCEEDED, `Bugetul zilnic pentru ${feature} a fost depasit. Contacteaza adminul.`, c, {
          usedMilli,
          limitMilli,
          feature,
          source: override ? "override" : "default",
        }),
        429
      );
    }

    return next();
  };
}

function secondsUntilUtcMidnight(now = new Date()): number {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 1000));
}

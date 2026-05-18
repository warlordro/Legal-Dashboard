import type { Context, Next } from "hono";

import { getAuthMode } from "../auth/config.ts";
import { sumAiUsageMilliToday } from "../db/aiUsageRepository.ts";
import { getOverride } from "../db/userQuotaRepository.ts";
import { getOwnerId } from "./owner.ts";
import { ErrorCodes, fail } from "../util/envelope.ts";

export type QuotaFeature = "ai.single" | "ai.multi";

export function quotaGuard(feature: QuotaFeature) {
  return async (c: Context, next: Next) => {
    if (getAuthMode() !== "web") return next();
    const ownerId = getOwnerId(c);
    const override = getOverride(ownerId, feature);
    if (!override) return next();

    const usedMilli = sumAiUsageMilliToday(ownerId, feature);
    if (usedMilli >= override.daily_limit_usd_milli) {
      const retryAfter = secondsUntilUtcMidnight();
      c.header("Retry-After", String(retryAfter));
      return c.json(
        fail(ErrorCodes.QUOTA_EXCEEDED, `Bugetul zilnic pentru ${feature} a fost depasit. Contacteaza adminul.`, c, {
          usedMilli,
          limitMilli: override.daily_limit_usd_milli,
          feature,
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

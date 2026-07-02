import type { Context } from "hono";

import { getAuthMode } from "../auth/config.ts";
import { getTokenCaptchaCap } from "../db/apiTokenRepository.ts";
import {
  countTenantCaptchaUsageInWindow,
  earliestTenantCaptchaTsInWindow,
  recordCaptchaUsage,
  reserveTokenCaptcha,
} from "../db/captchaUsageRepository.ts";
import { getTenantKeys, type CaptchaMode, type CaptchaProvider } from "../db/tenantKeysRepository.ts";
import { type QuotaPeriod, getOverride } from "../db/userQuotaRepository.ts";
import { getOwnerId } from "../middleware/owner.ts";
import { getRequestId } from "../middleware/requestId.ts";
import { ErrorCodes, fail } from "../util/envelope.ts";

// v2.34.0 P1-4 — per-user captcha quota (mirror al rolling-window din quotaGuard).
// 24h / 7d / 30d, configurabil din `/admin/quota` cu feature `captcha.rnpm`.
const CAPTCHA_QUOTA_FEATURE = "captcha.rnpm";

const CAPTCHA_PERIOD_SECONDS: Record<QuotaPeriod, number> = {
  day: 86_400,
  week: 604_800,
  month: 2_592_000,
};

// Default cap pe captcha-uri / fereastra rolling pentru useri fara override.
// Format: integer non-negativ (numar de captcha-uri). Unset = pass-through
// (backward compatible: niciun cap). 0 = block hard pe orice user fara override.
function readDefaultCaptchaQuota(): number | null {
  const raw = process.env.LEGAL_DASHBOARD_DEFAULT_CAPTCHA_QUOTA;
  if (raw === undefined || raw === "") return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) return null;
  return parsed;
}

function captchaRetryAfterSeconds(ownerId: string, windowSeconds: number, now: Date = new Date()): number {
  const earliest = earliestTenantCaptchaTsInWindow(ownerId, windowSeconds);
  if (!earliest) return windowSeconds;
  const earliestMs = Date.parse(earliest);
  if (Number.isNaN(earliestMs)) return windowSeconds;
  const releaseMs = earliestMs + windowSeconds * 1000;
  const deltaSec = Math.ceil((releaseMs - now.getTime()) / 1000);
  return Math.max(1, deltaSec);
}

export type RnpmCaptchaGuardResult =
  | {
      ok: true;
      // "body" = desktop BYOK; "tenant" = web tenant-shared key from
      // `tenant_api_keys`. Routes use this to audit tenant captcha consumption
      // so admins can attribute the shared wallet burn to individual users.
      source: "body" | "tenant";
      body: Record<string, unknown>;
      captchaKey: string;
      captchaProvider?: CaptchaProvider;
      captchaMode?: CaptchaMode;
      fallback2CaptchaKey?: string;
    }
  | { ok: false; response: Response };

export type CaptchaResolution =
  | { source: "body" }
  | { source: "tenant"; ok: true; captchaKey: string; provider: CaptchaProvider; mode: CaptchaMode }
  | { source: "tenant"; ok: false; response: Response };

export async function withRnpmCaptchaGuards(c: Context): Promise<RnpmCaptchaGuardResult> {
  const body = await parseJsonBody(c);
  if (body === null) {
    return {
      ok: false,
      response: c.json(fail(ErrorCodes.INVALID_JSON, "JSON invalid", c), 400),
    };
  }

  const resolved = resolveCaptchaKeyForRoute(c);
  if (resolved.source === "tenant") {
    if (!resolved.ok) return { ok: false, response: resolved.response };
    // Web mode side note: if the request body still ships a `captchaKey`
    // string, we silently ignore it (the tenant key wins) but log a warning
    // so the admin can see that a client tried to BYOK in web mode. Logging
    // the *fact* not the *value* — never echo the body key to stdout.
    const bodyCaptchaKey = (body as { captchaKey?: unknown } | null)?.captchaKey;
    if (typeof bodyCaptchaKey === "string" && bodyCaptchaKey.length > 0) {
      console.warn(
        `[rnpm.guards] body.captchaKey ignored in web mode (tenant key wins) path=${c.req.path} method=${c.req.method}`
      );
    }

    // v2.34.0 P1-4: cap pe captcha-uri / fereastra rolling. Override-ul din
    // /admin/quota cu feature 'captcha.rnpm' se interpreteaza ca NUMAR de
    // captcha-uri (NU milli-USD). Default-ul vine din env.
    const ownerId = getOwnerId(c);
    const override = getOverride(ownerId, CAPTCHA_QUOTA_FEATURE);
    const defaultCap = readDefaultCaptchaQuota();
    const limitCount = override ? override.limit_usd_milli : defaultCap;
    if (limitCount !== null) {
      const period: QuotaPeriod = override?.period ?? "day";
      const windowSeconds = CAPTCHA_PERIOD_SECONDS[period];
      const used = countTenantCaptchaUsageInWindow(ownerId, windowSeconds);
      if (limitCount === 0 || used >= limitCount) {
        const retryAfter = captchaRetryAfterSeconds(ownerId, windowSeconds);
        c.header("Retry-After", String(retryAfter));
        return {
          ok: false,
          response: c.json(
            fail(ErrorCodes.QUOTA_EXCEEDED, "Cota de captcha-uri a fost atinsa. Contacteaza adminul.", c, {
              used,
              limit: limitCount,
              period,
              feature: CAPTCHA_QUOTA_FEATURE,
              source: override ? "override" : "default",
            }),
            429
          ),
        };
      }
    }

    // PAT (piesa A, A5.3): plafon captcha per-token, SUB bugetul per-user de mai sus.
    // Token CU plafon => fail-CLOSED (rezervare atomica: daca tranzactia pica, respinge
    // 503 retry — NU accepta peste plafon, NU 500). Token FARA plafon (sau fara tokenId)
    // => calea record-and-accept de mai jos (fail-OPEN, "overcount, never undercount").
    const tokenId = c.get("tokenId");
    if (tokenId) {
      const cap = getTokenCaptchaCap(tokenId);
      if (cap !== null) {
        // Rezervarea atomica (BEGIN IMMEDIATE + count + insert) traieste in repository
        // (captchaUsageRepository.reserveTokenCaptcha) — SQL raw ramane in db/**. Aici doar
        // maparea rezultatului la raspuns HTTP: throw => fail-CLOSED 503; false => 429 cap atins.
        let reserved: boolean;
        try {
          reserved = reserveTokenCaptcha({
            ownerId,
            tokenId,
            provider: resolved.provider,
            requestId: getRequestId(c),
            cap,
            windowSeconds: 86_400,
          });
        } catch (err) {
          console.error("[rnpm.guards] token captcha reservation failed", err);
          c.header("Retry-After", "5");
          return {
            ok: false,
            response: c.json(
              fail(ErrorCodes.QUOTA_EXCEEDED, "Rezervare captcha indisponibila, reincearca.", c, {
                feature: "captcha.token",
                retry: true,
              }),
              503
            ),
          };
        }
        if (!reserved) {
          c.header("Retry-After", "86400");
          return {
            ok: false,
            response: c.json(
              fail(ErrorCodes.QUOTA_EXCEEDED, "Plafonul de captcha al tokenului a fost atins.", c, {
                feature: "captcha.token",
                cap,
              }),
              429
            ),
          };
        }
        // Captcha-ul a fost deja inregistrat in tranzactie (cu token_id); sari peste
        // record-and-accept-ul de mai jos pentru calea cu tokenId + cap.
        return {
          ok: true,
          source: "tenant",
          body: body as Record<string, unknown>,
          captchaKey: resolved.captchaKey,
          captchaProvider: resolved.provider,
          captchaMode: resolved.mode,
        };
      }
    }

    // Record-and-accept: contam captcha-ul ca "intent-based" (1 row per request
    // acceptat de guard). Daca SOAP-ul ulterior nu mai consuma cheia (timeout
    // / abort), riscul e overcount, niciodata undercount — exact semantica pe
    // care o vrem la un cap operational. requestId leaga randul de auditul
    // existent (`rnpm.captcha.consume`). tokenId ?? null: calea FARA plafon
    // (sau JWT/desktop) tot tag-uieste randul cu tokenul, daca exista.
    try {
      recordCaptchaUsage({
        ownerId,
        provider: resolved.provider,
        source: "tenant",
        requestId: getRequestId(c),
        tokenId: tokenId ?? null,
      });
    } catch (err) {
      console.error("[rnpm.guards] captcha usage record failed", err);
    }

    return {
      ok: true,
      source: "tenant",
      body: body as Record<string, unknown>,
      captchaKey: resolved.captchaKey,
      captchaProvider: resolved.provider,
      captchaMode: resolved.mode,
    };
  }

  const captchaKey = (body as { captchaKey?: unknown })?.captchaKey;
  if (!isValidCaptchaKey(captchaKey)) {
    return {
      ok: false,
      response: c.json(fail(ErrorCodes.INVALID_CAPTCHA_KEY, "Cheie captcha lipsa sau invalida", c), 400),
    };
  }

  const b = body as { captchaProvider?: unknown; captchaMode?: unknown; fallback2CaptchaKey?: unknown };
  return {
    ok: true,
    source: "body",
    body: body as Record<string, unknown>,
    captchaKey,
    captchaProvider:
      b.captchaProvider === "capsolver" || b.captchaProvider === "2captcha" ? b.captchaProvider : undefined,
    captchaMode: b.captchaMode === "race" ? "race" : "sequential",
    fallback2CaptchaKey: typeof b.fallback2CaptchaKey === "string" ? b.fallback2CaptchaKey : undefined,
  };
}

// Body parse helper: returns parsed JSON or null on parse failure / literal-null body.
// Caller-ul early-return-uie cu invalidJson(c) la null. Literal `null` body era anterior
// coerced la `{}` via `(body ?? {})`; e nonsens semantic pe rutele astea, deci e OK
// sa-l respingem ca input invalid. Convention: returneaza null in loc sa throw, matching
// parseClientRequestId.
export async function parseJsonBody(c: Context): Promise<unknown | null> {
  try {
    const body = await c.req.json();
    return body == null ? null : body;
  } catch {
    return null;
  }
}

// Web-readiness closure (#12): in `desktop` mode, `captchaKey` vine din
// safeStorage in renderer si e trimis cu fiecare request - comportament
// pastrat. In `web` mode browserul nu trebuie sa puna cheia in body
// (localStorage/inspectabil), asa ca rutele care primesc `captchaKey`
// raspund 501 pana cand exista per-user server-side storage. Rutele de
// `/saved`, `/searches`, `/stats`, `/backups/*` raman functionale; doar
// caile care fac call efectiv la captcha provider sunt blocate.
export function rejectCaptchaKeyInWebMode(c: Context): Response | null {
  const resolved = resolveCaptchaKeyForRoute(c);
  return resolved.source === "tenant" && !resolved.ok ? resolved.response : null;
}

export function resolveCaptchaKeyForRoute(c: Context): CaptchaResolution {
  if (getAuthMode() !== "web") return { source: "body" };
  const tenant = getTenantKeys();
  const provider = tenant.captchaProvider;
  const key = provider === "capsolver" ? tenant.capsolver : tenant.twocaptcha;
  if (!key) {
    return {
      source: "tenant",
      ok: false,
      response: c.json(
        fail(ErrorCodes.CAPTCHA_NOT_CONFIGURED, "Cheia captcha nu e configurata. Contacteaza adminul.", c),
        501
      ),
    };
  }
  return { source: "tenant", ok: true, captchaKey: key, provider, mode: tenant.captchaMode };
}

// Captcha key validation predicate: rejects empty / whitespace-only / sub-10-char
// strings. Length 10 e arbitrar dar prinde tipic erori (gol, "DEMO", "test").
function isValidCaptchaKey(input: unknown): input is string {
  return typeof input === "string" && input.trim().length >= 10;
}

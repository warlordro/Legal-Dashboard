import type { Context } from "hono";

import { getAuthMode } from "../auth/config.ts";
import { getTenantKeys, type CaptchaMode, type CaptchaProvider } from "../db/tenantKeysRepository.ts";
import { ErrorCodes, fail } from "../util/envelope.ts";

export type RnpmCaptchaGuardResult =
  | {
      ok: true;
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
    return {
      ok: true,
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

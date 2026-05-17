import type { Context } from "hono";

import { getAuthMode } from "../auth/config.ts";
import { ErrorCodes, fail } from "../util/envelope.ts";

export type RnpmCaptchaGuardResult =
  | { ok: true; body: Record<string, unknown>; captchaKey: string }
  | { ok: false; response: Response };

export async function withRnpmCaptchaGuards(c: Context): Promise<RnpmCaptchaGuardResult> {
  const webGate = rejectCaptchaKeyInWebMode(c);
  if (webGate) return { ok: false, response: webGate };

  const body = await parseJsonBody(c);
  if (body === null) {
    return {
      ok: false,
      response: c.json(fail(ErrorCodes.INVALID_JSON, "JSON invalid", c), 400),
    };
  }

  const captchaKey = (body as { captchaKey?: unknown })?.captchaKey;
  if (!isValidCaptchaKey(captchaKey)) {
    return {
      ok: false,
      response: c.json(fail(ErrorCodes.INVALID_CAPTCHA_KEY, "Cheie captcha lipsa sau invalida", c), 400),
    };
  }

  return { ok: true, body: body as Record<string, unknown>, captchaKey };
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
  if (getAuthMode() !== "web") return null;
  return c.json(
    fail(
      ErrorCodes.WEB_MODE_NOT_IMPLEMENTED,
      "RNPM in web mode necesita stocare server-side a cheii captcha. Folositi desktop sau asteptati per-user key storage.",
      c
    ),
    501
  );
}

// Captcha key validation predicate: rejects empty / whitespace-only / sub-10-char
// strings. Length 10 e arbitrar dar prinde tipic erori (gol, "DEMO", "test").
function isValidCaptchaKey(input: unknown): input is string {
  return typeof input === "string" && input.trim().length >= 10;
}

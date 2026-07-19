import type { Context, Next } from "hono";
import { getAuthMode } from "../auth/config.ts";
import { fail } from "../util/envelope.ts";

// SEC-01: originGuard has a loopback bypass, so a hostile page can fire a
// simple-request POST at 127.0.0.1 with no preflight. The custom header
// X-Legal-Dashboard-Desktop cannot be set on a simple cross-origin request, so
// requiring it on every mutating verb forces a CORS preflight the attacker
// cannot satisfy. apiFetch sends it on every call; SSE (GET) stays exempt.
// The tokenId exemption is DEFENSE-IN-DEPTH / future-proofing: in desktop mode
// tokenId is never set (PAT middleware is web-only, index.ts:300-310), so this
// branch is inactive today — it only matters if PAT ever runs in desktop.
const DESKTOP_HEADER = "x-legal-dashboard-desktop";
const DESKTOP_HEADER_VALUE = "1";
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function requireDesktopHeaderGlobal(c: Context, next: Next): Promise<Response | undefined> {
  if (getAuthMode() !== "desktop") return void (await next());
  if (process.env.LEGAL_DASHBOARD_DISABLE_CSRF_HARDENING === "1") return void (await next());
  if (!MUTATING.has(c.req.method.toUpperCase())) return void (await next());
  if (c.get("tokenId")) return void (await next());
  if (c.req.header(DESKTOP_HEADER) !== DESKTOP_HEADER_VALUE) {
    return c.json(
      fail("desktop_header_required", "Cerere refuzata: header X-Legal-Dashboard-Desktop lipsa sau invalida.", c),
      403
    );
  }
  await next();
  return;
}

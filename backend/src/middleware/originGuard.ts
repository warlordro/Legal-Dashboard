// originGuard.ts — F2 audit hardening (2026-04-30).
//
// CSRF defense for state-changing routes when the backend is bound to a
// non-loopback interface (LEGAL_DASHBOARD_ALLOW_REMOTE=1 or non-loopback HOST).
// Until PR-9 ships real auth + same-site cookies, a malicious page on the LAN
// could trigger any POST/PUT/PATCH/DELETE in the user's browser context.
//
// Policy:
//   - GET / HEAD / OPTIONS: pass-through (no state change).
//   - Loopback callers (Electron renderer, localhost web client, curl on box):
//     pass-through. Detected by socket-level remote address — Origin header is
//     spoofable, but the TCP peer address is not (without root-level network
//     control).
//   - Origin (or Referer fallback) host MUST equal Host header host. Same-host
//     covers the supported deployment shape (frontend served from same origin
//     as API). Cross-origin POSTs are rejected.
//   - Missing Origin AND Referer on a state-change from a non-loopback caller
//     is rejected. Browsers attach Origin to every cross-origin POST since
//     Chrome 76 / Firefox 70; a bare POST without either header is either an
//     old client or a hostile script that stripped them.
//
// This is a complement to (not a replacement for) PR-9 auth. Once auth ships
// and routes require a JWT, CSRF token can be embedded in the JWT and this
// middleware can be tightened to require the token instead of just-Origin.

import type { Context, Next } from "hono";
import { isLoopbackAddress, readClientIp } from "../util/proxyIp.ts";
import { fail } from "../util/envelope.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function safeHost(input: string | undefined | null): string | null {
  if (!input) return null;
  try {
    return new URL(input).host || null;
  } catch {
    return null;
  }
}

export async function originGuard(c: Context, next: Next): Promise<Response | undefined> {
  const method = c.req.method.toUpperCase();
  if (SAFE_METHODS.has(method)) {
    await next();
    return;
  }

  // Loopback bypass: Electron renderer + dev tools fire requests from the
  // local machine. The TCP peer address is the trustworthy signal — Origin
  // headers from a localhost browser look identical regardless of how the
  // app was loaded, but the socket reveals whether it came over the LAN.
  const remoteAddr = readClientIp(c);
  if (isLoopbackAddress(remoteAddr)) {
    await next();
    return;
  }

  const hostHeader = c.req.header("host") ?? "";
  if (!hostHeader) {
    return c.json(fail("csrf_origin_mismatch", "Cerere refuzata: Host header lipseste.", c), 403);
  }

  const originHost = safeHost(c.req.header("origin"));
  const refererHost = safeHost(c.req.header("referer"));
  const claimedHost = originHost ?? refererHost;

  if (!claimedHost) {
    return c.json(
      fail("csrf_origin_mismatch", "Cerere refuzata: Origin/Referer lipseste pentru o ruta de modificare.", c),
      403
    );
  }

  if (claimedHost !== hostHeader) {
    return c.json(
      fail("csrf_origin_mismatch", `Cerere refuzata: Origin ${claimedHost} nu corespunde Host ${hostHeader}.`, c),
      403
    );
  }

  await next();
  return;
}

// requireDesktopHeader.ts — F11-F1 audit hardening (2026-05-14).
//
// CSRF defense in depth pentru POST-urile admin body-less, in plus fata de
// originGuard. Motivatie: originGuard are bypass de loopback (peer-ul TCP de
// pe 127.0.0.1 trece pass-through, ca Electron + Vite dev sa nu se autoblock-
// eze). Daca user-ul ruleaza in paralel Electron app (cu backend pe localhost)
// si un browser pe attacker.com, o pagina ostila poate emite un simple-POST
// (Content-Type form-urlencoded / text/plain / fara body) catre rute admin —
// browser-ul nu mai face preflight CORS, si originGuard nu mai gateaza pe
// loopback. Atacul reuseste pe rutele admin body-less (DELETE /saved/all,
// POST /compact, POST /open-db-folder, POST /open-backups-folder).
//
// Header-ul custom `X-Legal-Dashboard-Desktop: 1` nu poate fi setat de un
// simple-POST cross-origin — il setam doar din renderer-ul propriu via
// apiFetch (frontend/src/lib/api.ts). Browser-ul ostil care l-ar trimite ar
// declansa preflight CORS, care esueaza pe configul existent (no CORS allow
// list for non-loopback Origins). Net efect: requirement de header echivalent
// cu un CSRF token implicit dat de SOP-ul browser-ului.
//
// Gating:
//   - desktop mode: header OBLIGATORIU. Lipsa = 403 forbidden.
//   - web mode: pass-through. Web cutover-ul foloseste sesiuni SSO + CSRF
//     token clasic (PR ulterior); header-ul nu se aplica pe rute server-side
//     unde requestul vine prin sesiune autentificata.
//
// Aplicare: in rnpm.ts compus dupa requireRole, pe POST-urile admin body-
// less. NU se aplica pe POST-uri cu body JSON validat (acelea declanseaza
// preflight prin Content-Type: application/json) sau pe GET-uri.

import type { Context, Next } from "hono";
import { getAuthMode } from "../auth/config.ts";
import { ErrorCodes, fail } from "../util/envelope.ts";

const DESKTOP_HEADER = "x-legal-dashboard-desktop";
const DESKTOP_HEADER_VALUE = "1";

export async function requireDesktopHeader(c: Context, next: Next): Promise<Response | undefined> {
  if (getAuthMode() !== "desktop") {
    await next();
    return;
  }

  const headerValue = c.req.header(DESKTOP_HEADER);
  if (headerValue !== DESKTOP_HEADER_VALUE) {
    return c.json(
      fail(
        ErrorCodes.DESKTOP_HEADER_REQUIRED,
        "Cerere refuzata: header X-Legal-Dashboard-Desktop lipsa sau invalida.",
        c
      ),
      403
    );
  }

  await next();
  return;
}

import type { Context, Next } from "hono";
import { ErrorCodes, fail } from "../util/envelope.ts";

// patSecurity — controale obligatorii pentru raspunsurile PAT (piesa A):
//   - Cache-Control: no-store (+ Pragma) pe ORICE raspuns PAT (date juridice nu se
//     cacheaza de intermediari / LLM context store). Setat via c.header() INAINTE de
//     next(): Hono propaga headerul in raspunsul final, inclusiv pe 403/426/429 generate
//     de middleware-uri din aval (gate). Evita c.res.headers.set(...) dupa next(), care
//     poate arunca pe headere imutabile sau poate sa nu prinda raspunsul nou.
//   - HTTPS hint in productie: respinge PAT cand `x-forwarded-proto` != "https" (426).
//     IMPORTANT (review 2026-07-01): `x-forwarded-proto` e un header PROXY, NU dovada
//     criptografica de TLS si NU o poate verifica aplicatia (TLS e terminat la proxy, deci
//     socket-ul vede plain HTTP). E setabil de client => spoofabil daca reverse-proxy-ul NU
//     strip-uieste valoarea venita de la client. Deci acest check e DEFENSE-IN-DEPTH impotriva
//     folosirii accidentale in plaintext de catre un client legitim; NU o granita de securitate.
//     Garantia reala de HTTPS = reverse-proxy-ul care termina TLS (si care TREBUIE configurat sa
//     rescrie `x-forwarded-proto` din conexiunea reala, ignorand orice valoare client) + HSTS.
//     Vezi DEPLOY-SERVER.md. Dev/loopback: LEGAL_DASHBOARD_PAT_ALLOW_HTTP=1.
// Outermost in lantul PAT (montat inaintea gate-ului) — are nevoie de tokenId (setat de
// ownerContext, care ruleaza inainte).
export async function patSecurity(c: Context, next: Next): Promise<Response | undefined> {
  const isPat = !!c.get("tokenId");
  if (isPat) {
    c.header("Cache-Control", "no-store");
    c.header("Pragma", "no-cache");
    if (
      process.env.NODE_ENV === "production" &&
      process.env.LEGAL_DASHBOARD_PAT_ALLOW_HTTP !== "1" &&
      c.req.header("x-forwarded-proto") !== "https"
    ) {
      // 426 mosteneste no-store-ul setat mai sus (c.json merge-uie headerele de context).
      return c.json(fail(ErrorCodes.PAT_ROUTE_FORBIDDEN, "PAT necesita HTTPS.", c), 426);
    }
  }
  await next();
  return;
}

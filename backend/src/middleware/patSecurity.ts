import type { Context, Next } from "hono";
import { ErrorCodes, fail } from "../util/envelope.ts";

// patSecurity — controale obligatorii pentru raspunsurile PAT (piesa A):
//   - Cache-Control: no-store (+ Pragma) pe ORICE raspuns PAT (date juridice nu se
//     cacheaza de intermediari / LLM context store). Setat via c.header() INAINTE de
//     next(): Hono propaga headerul in raspunsul final, inclusiv pe 403/426/429 generate
//     de middleware-uri din aval (gate). Evita c.res.headers.set(...) dupa next(), care
//     poate arunca pe headere imutabile sau poate sa nu prinda raspunsul nou.
//   - HTTPS-only in productie: respinge PAT peste non-TLS (426). Nu permite bypass pe peer
//     loopback in prod; dev/loopback se controleaza explicit cu LEGAL_DASHBOARD_PAT_ALLOW_HTTP=1.
// Outermost in lantul PAT (montat inaintea gate-ului in Task 16) — vezi has nevoie de tokenId
// (setat de ownerContext, care ruleaza inainte).
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

import type { Context, Next } from "hono";
import { hasPriorTokenUseFromIp, recordAudit } from "../db/auditRepository.ts";
import { touchLastUsed } from "../db/apiTokenRepository.ts";
import { notifyTokenNewIp } from "../services/tokenAlerts.ts";
import { readClientIp } from "../util/proxyIp.ts";

// patUsageAudit — INVELESTE gate-ul (montat INAINTE de patCapabilityGate). Ruleaza
// `await next()` (gate + rateLimit ruleaza inauntru), apoi ramifica pe `c.res.status`:
//   - denied (>=400): audit outcome="denied", FARA email (esantionat pe cazul de succes).
//   - ok: audit esantionat (o data per (token, ip) per zi SAU la IP nou) + touchLastUsed +
//     alerta de IP nou (best-effort, .catch — nu darama requestul).
// De ce NU dupa gate: gate-ul face `return c.json(403)` fara `next()`, deci un middleware
// inregistrat dupa el nu ar rula niciodata; auditul de 403 s-ar pierde.

// Esantionare: o folosire ok auditata per (token, ip) per zi (nu 1 INSERT + 1 SELECT/request).
const auditedToday = new Map<string, string>(); // `${tokenId}|${ip}` -> YYYY-MM-DD
let lastPrunedDay = ""; // prune cross-day o singura data / zi, nu O(N) per request (fix runda 4)

export function _resetPatAuditForTest(): void {
  auditedToday.clear();
  lastPrunedDay = "";
}

export async function patUsageAudit(c: Context, next: Next): Promise<void> {
  const tokenId = c.get("tokenId");
  if (!tokenId) {
    await next();
    return; // doar PAT
  }
  await next();

  // runda 4: IP proxy-aware (acelasi `readClientIp` ca rate-limit/originGuard) — altfel in
  // spatele reverse-proxy-ului toate folosirile PAT s-ar inregistra cu IP-ul proxy-ului si
  // detectia de IP nou (token furat din alt IP real) ar fi oarba.
  const ip = readClientIp(c) || null;
  const ua = c.req.header("user-agent") ?? null;
  const denied = c.res.status >= 400; // gate/rateLimit a respins (403/429) -> audit denied, fara email
  const day = new Date().toISOString().slice(0, 10);
  // prune cross-day DOAR la rollover (nu scan O(N) pe fiecare request — fix runda 4).
  if (day !== lastPrunedDay) {
    lastPrunedDay = day;
    for (const [k, d] of auditedToday) {
      if (d !== day) auditedToday.delete(k);
    }
  }
  const key = `${tokenId}|${ip ?? "?"}`;

  try {
    if (denied) {
      recordAudit(c, "api_token.used", {
        outcome: "denied",
        targetKind: "api_token",
        targetId: tokenId,
        ip,
        userAgent: ua,
        detail: { path: c.req.path, status: c.res.status },
      });
      return;
    }
    // Sari peste probe-ul de IP nou daca (token, ip) a fost deja vazut azi — nu poate fi "nou"
    // (fix runda 4: evita un SELECT pe hot-path pentru IP-uri deja auditate azi).
    const seenToday = auditedToday.get(key) === day;
    const newIp = !seenToday && ip ? !hasPriorTokenUseFromIp(tokenId, ip) : false;
    touchLastUsed(tokenId, ip, ua);
    if (!seenToday || newIp) {
      auditedToday.set(key, day);
      recordAudit(c, "api_token.used", {
        outcome: "ok",
        targetKind: "api_token",
        targetId: tokenId,
        ip,
        userAgent: ua,
        detail: { newIp, path: c.req.path },
      });
    }
    if (newIp && ip) void notifyTokenNewIp(c, tokenId, ip).catch(() => {});
  } catch (err) {
    console.error("[patUsageAudit] failed", err); // niciodata nu darama requestul
  }
}

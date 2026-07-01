import type { Context, Next } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { hasPriorTokenUseFromIp, recordAudit } from "../db/auditRepository.ts";
import { touchLastUsed } from "../db/apiTokenRepository.ts";
import { notifyTokenNewIp } from "../services/tokenAlerts.ts";

// patUsageAudit — INVELESTE gate-ul (montat INAINTE de patCapabilityGate). Ruleaza
// `await next()` (gate + rateLimit ruleaza inauntru), apoi ramifica pe `c.res.status`:
//   - denied (>=400): audit outcome="denied", FARA email (esantionat pe cazul de succes).
//   - ok: audit esantionat (o data per (token, ip) per zi SAU la IP nou) + touchLastUsed +
//     alerta de IP nou (best-effort, .catch — nu darama requestul).
// De ce NU dupa gate: gate-ul face `return c.json(403)` fara `next()`, deci un middleware
// inregistrat dupa el nu ar rula niciodata; auditul de 403 s-ar pierde.

// Esantionare: o folosire ok auditata per (token, ip) per zi (nu 1 INSERT + 1 SELECT/request).
const auditedToday = new Map<string, string>(); // `${tokenId}|${ip}` -> YYYY-MM-DD

export function _resetPatAuditForTest(): void {
  auditedToday.clear();
}

export async function patUsageAudit(c: Context, next: Next): Promise<void> {
  const tokenId = c.get("tokenId");
  if (!tokenId) {
    await next();
    return; // doar PAT
  }
  await next();

  let ip: string | null = null;
  try {
    ip = getConnInfo(c).remote.address ?? null;
  } catch {
    ip = null;
  }
  const ua = c.req.header("user-agent") ?? null;
  const denied = c.res.status >= 400; // gate/rateLimit a respins (403/429) -> audit denied, fara email
  const day = new Date().toISOString().slice(0, 10);
  // prune cross-day: harta nu creste nemarginit intr-un proces web long-lived.
  for (const [k, d] of auditedToday) {
    if (d !== day) auditedToday.delete(k);
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
    const newIp = ip ? !hasPriorTokenUseFromIp(tokenId, ip) : false;
    touchLastUsed(tokenId, ip, ua);
    if (auditedToday.get(key) !== day || newIp) {
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

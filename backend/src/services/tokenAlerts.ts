import type { Context } from "hono";
import { isMailerConfigured, sendComposedEmail } from "./email/mailer.ts";
import { getEmailSettings } from "../db/ownerEmailSettingsRepository.ts";

// Alerta de securitate: un token API a fost folosit dintr-un IP nou. Trimite email prin
// infra existenta (owner_email_settings + mailer). Dedup in-proces per (tokenId, ip) pe
// fereastra, ca un burst multi-IP sa nu produca un flood de email-uri.
const sentRecently = new Map<string, number>(); // `${tokenId}|${ip}` -> ts
const DEDUP_MS = 60 * 60 * 1000;

export function _resetTokenAlertsForTest(): void {
  sentRecently.clear();
}

export async function notifyTokenNewIp(c: Context, tokenId: string, ip: string): Promise<void> {
  if (!isMailerConfigured()) return;
  // Destinatar = adresa configurata a owner-ului (ca alertEmailDispatcher). ownerId din
  // context (setat de ownerContext; PAT deriva ownerId = user.id). Fara adresa -> return.
  // Alerta de securitate: NU o gate-uim pe flag-ul de monitoring `enabled`, doar pe adresa.
  const ownerId = c.get("ownerId");
  if (!ownerId) return;
  const to = getEmailSettings(ownerId)?.toAddress;
  if (!to) return;

  const now = Date.now();
  // sweep DOAR cand harta a crescut (nu O(N) pe fiecare alerta — fix runda 4); intrarile
  // expirate se curata la burst, nu la fiecare apel.
  if (sentRecently.size > 500) {
    for (const [k, t] of sentRecently) {
      if (now - t >= DEDUP_MS) sentRecently.delete(k);
    }
  }
  const key = `${tokenId}|${ip}`;
  const last = sentRecently.get(key);
  if (last && now - last < DEDUP_MS) return;
  sentRecently.set(key, now); // mark inainte de send: anti-flood la burst pe acelasi (token, ip)

  const shortId = tokenId.slice(0, 8);
  await sendComposedEmail(to, {
    subject: "Token API folosit dintr-un IP nou",
    text: `Un token API (${shortId}...) a fost folosit dintr-un IP nou: ${ip}.\nDaca nu recunosti activitatea, revoca tokenul din Setari -> Acces API.`,
    html: `<p>Un token API (<code>${shortId}…</code>) a fost folosit dintr-un IP nou: <strong>${ip}</strong>.</p><p>Daca nu recunosti activitatea, revoca tokenul din Setari &rarr; Acces API.</p>`,
  });
}

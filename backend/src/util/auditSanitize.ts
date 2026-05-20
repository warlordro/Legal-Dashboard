import { createHash } from "node:crypto";

const EMAIL_REGEX = /\S+@\S+\.\S+/g;
const SMTP_HOST_REGEX = /\b(?:mail|smtp|relay|mx)[-.][\w.-]+\.[a-z]{2,}\b/gi;
const SMTP_CODE_WHITELIST = new Set(["ECONNREFUSED", "ETIMEDOUT", "EAUTH", "EENVELOPE", "ESOCKET", "EMESSAGE"]);

export function truncateAuditText(value: string | null | undefined, max = 200): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max);
}

// SHA-256 prefix 16 hex peste email normalizat (trim + lowercase). Folosit in
// audit_log ca sa avem un identificator stabil per adresa fara sa scriem
// plaintext. Reutilizat din `auth.ts` (sync oauth2-proxy) si `me.ts`
// (self-update email settings).
export function hashEmail(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 16);
}

export function emailLast4(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(-4);
}

// Whitelist explicit pentru audit-ul `me.email_settings.update`. Evita
// serializarea raw a `before/after` (care contineau `toAddress` plaintext —
// GDPR/PII). Returneaza forma sigura: pentru email doar hash + last4 +
// `hadPrevious` flag; pentru restul (boolean / enum) pastreaza valoarea
// efectiva (nu e identifiable info).
export interface EmailSettingsAuditInput {
  enabled: boolean;
  toAddress: string | null;
  minSeverity: "info" | "warning" | "critical";
  dailyReportEnabled: boolean;
}

export function buildEmailSettingsAuditDetail(
  before: EmailSettingsAuditInput | null | undefined,
  after: EmailSettingsAuditInput
): Record<string, unknown> {
  const beforeAddr = before?.toAddress ?? null;
  const afterAddr = after.toAddress ?? null;
  return {
    enabledBefore: before?.enabled ?? null,
    enabledAfter: after.enabled,
    minSeverityBefore: before?.minSeverity ?? null,
    minSeverityAfter: after.minSeverity,
    dailyReportBefore: before?.dailyReportEnabled ?? null,
    dailyReportAfter: after.dailyReportEnabled,
    toAddressHadPrevious: beforeAddr !== null && beforeAddr.length > 0,
    toAddressHashBefore: beforeAddr ? hashEmail(beforeAddr) : null,
    toAddressHashAfter: afterAddr ? hashEmail(afterAddr) : null,
    toAddressLast4Before: emailLast4(beforeAddr),
    toAddressLast4After: emailLast4(afterAddr),
    toAddressChanged: beforeAddr !== afterAddr,
  };
}

export function sanitizeSmtpError(err: unknown): { code: string; responseCode: number | null; message: string } {
  const shaped = err as { code?: unknown; responseCode?: unknown; message?: unknown };
  const rawCode = typeof shaped.code === "string" ? shaped.code : "";
  const code = SMTP_CODE_WHITELIST.has(rawCode) ? rawCode : "ESMTP";
  const rawResponseCode = typeof shaped.responseCode === "number" ? Math.floor(shaped.responseCode) : null;
  const responseCode =
    rawResponseCode !== null && rawResponseCode >= 400 && rawResponseCode <= 599 ? rawResponseCode : null;
  let message = typeof shaped.message === "string" ? shaped.message : String(err);
  message = message.slice(0, 500).replace(/(RCPT TO|MAIL FROM)[:\s][^\s]+/gi, "$1 [addr]");
  message = message.replace(EMAIL_REGEX, "[email]").replace(SMTP_HOST_REGEX, "[smtp-host]");
  return { code, responseCode, message: truncateAuditText(message, 200) ?? "" };
}

const EMAIL_REGEX = /\S+@\S+\.\S+/g;
const SMTP_HOST_REGEX = /\b(?:mail|smtp|relay|mx)[-.][\w.-]+\.[a-z]{2,}\b/gi;
const SMTP_CODE_WHITELIST = new Set(["ECONNREFUSED", "ETIMEDOUT", "EAUTH", "EENVELOPE", "ESOCKET", "EMESSAGE"]);

export function truncateAuditText(value: string | null | undefined, max = 200): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max);
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

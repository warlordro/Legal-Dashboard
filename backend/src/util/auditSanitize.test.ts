import { describe, expect, it } from "vitest";

import { sanitizeSmtpError, truncateAuditText } from "./auditSanitize.ts";

describe("auditSanitize", () => {
  it("redacts SMTP addresses, hostnames and envelope commands", () => {
    const sanitized = sanitizeSmtpError({
      code: "EAUTH",
      responseCode: 535,
      message:
        "EAUTH user admin@example.com via smtp.mail.example.com RCPT TO:<client@example.com> MAIL FROM:<alerts@example.com>",
    });

    expect(sanitized).toEqual({
      code: "EAUTH",
      responseCode: 535,
      message: "EAUTH user [email] via [smtp-host] RCPT TO [addr] MAIL FROM [addr]",
    });
  });

  it("normalizes unknown SMTP codes and clamps response codes", () => {
    const sanitized = sanitizeSmtpError({ code: "WEIRD", responseCode: 250, message: "ok" });

    expect(sanitized).toEqual({ code: "ESMTP", responseCode: null, message: "ok" });
  });

  it("truncates audit text after trimming", () => {
    expect(truncateAuditText("  abcdef  ", 3)).toBe("abc");
    expect(truncateAuditText(null)).toBeNull();
  });
});

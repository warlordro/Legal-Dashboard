import { describe, expect, it } from "vitest";

import {
  buildEmailSettingsAuditDetail,
  emailLast4,
  hashEmail,
  sanitizeSmtpError,
  truncateAuditText,
} from "./auditSanitize.ts";

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

  it("hashEmail produce 16 hex stabil pe email normalizat", () => {
    expect(hashEmail("Foo@Example.COM")).toBe(hashEmail("foo@example.com"));
    expect(hashEmail("  foo@example.com  ")).toBe(hashEmail("foo@example.com"));
    expect(hashEmail("foo@example.com")).toMatch(/^[0-9a-f]{16}$/);
  });

  it("emailLast4 intoarce ultimele 4 caractere sau null", () => {
    expect(emailLast4("abc@example.com")).toBe(".com");
    expect(emailLast4("")).toBeNull();
    expect(emailLast4(null)).toBeNull();
    expect(emailLast4(undefined)).toBeNull();
  });

  it("buildEmailSettingsAuditDetail nu contine email plaintext si pastreaza booleans/enums", () => {
    const before = {
      enabled: false,
      toAddress: "old@example.com",
      minSeverity: "info" as const,
      dailyReportEnabled: false,
    };
    const after = {
      enabled: true,
      toAddress: "new@example.com",
      minSeverity: "warning" as const,
      dailyReportEnabled: true,
    };

    const detail = buildEmailSettingsAuditDetail(before, after);
    const json = JSON.stringify(detail);

    expect(json).not.toContain("old@example.com");
    expect(json).not.toContain("new@example.com");
    expect(detail).toMatchObject({
      enabledBefore: false,
      enabledAfter: true,
      minSeverityBefore: "info",
      minSeverityAfter: "warning",
      dailyReportBefore: false,
      dailyReportAfter: true,
      toAddressHadPrevious: true,
      toAddressLast4Before: ".com",
      toAddressLast4After: ".com",
      toAddressChanged: true,
    });
    expect(detail.toAddressHashBefore).toMatch(/^[0-9a-f]{16}$/);
    expect(detail.toAddressHashAfter).toMatch(/^[0-9a-f]{16}$/);
    expect(detail.toAddressHashBefore).not.toBe(detail.toAddressHashAfter);
  });

  it("buildEmailSettingsAuditDetail accepta `before` null (prima salvare)", () => {
    const after = {
      enabled: true,
      toAddress: "first@example.com",
      minSeverity: "info" as const,
      dailyReportEnabled: false,
    };
    const detail = buildEmailSettingsAuditDetail(null, after);

    expect(detail).toMatchObject({
      enabledBefore: null,
      enabledAfter: true,
      toAddressHadPrevious: false,
      toAddressHashBefore: null,
      toAddressLast4Before: null,
      toAddressChanged: true,
    });
    expect(detail.toAddressHashAfter).toMatch(/^[0-9a-f]{16}$/);
  });

  it("buildEmailSettingsAuditDetail trateaza toAddress null in after", () => {
    const before = {
      enabled: true,
      toAddress: "old@example.com",
      minSeverity: "info" as const,
      dailyReportEnabled: false,
    };
    const after = {
      enabled: false,
      toAddress: null,
      minSeverity: "info" as const,
      dailyReportEnabled: false,
    };
    const detail = buildEmailSettingsAuditDetail(before, after);

    expect(detail.toAddressHashAfter).toBeNull();
    expect(detail.toAddressLast4After).toBeNull();
    expect(detail.toAddressHadPrevious).toBe(true);
    expect(detail.toAddressChanged).toBe(true);
  });
});

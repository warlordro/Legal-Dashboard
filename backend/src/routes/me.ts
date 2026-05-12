import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { recordAudit } from "../db/auditRepository.ts";
import {
  defaultEmailSettingsFor,
  getEmailSettings,
  upsertEmailSettings,
  type EmailSettings,
} from "../db/ownerEmailSettingsRepository.ts";
import { getUserById } from "../db/userRepository.ts";
import { getOwnerId } from "../middleware/owner.ts";
import { isMailerConfigured, sendTestEmail } from "../services/email/mailer.ts";
import { fail, ok } from "../util/envelope.ts";

// GET /api/v1/me — returns the current user's profile (id, email, role, status,
// displayName). Frontend uses this to decide whether to render the Admin
// sidebar section. Until PR-9 wires real auth, getOwnerId returns 'local' and
// the seeded `users.local` row is what comes back; PR-9 swaps this for the
// JWT-derived user id.

export const meRouter = new Hono();

const ME_BODY_LIMIT = 4096;
const limitMeBody = bodyLimit({
  maxSize: ME_BODY_LIMIT,
  onError: (c) => c.json(fail("payload_too_large", "Payload prea mare", c), 413),
});

// v2.10.1 #1: minSeverity ramane optional in body — clientii care nu il trimit
// (panoul curent EmailSettingsPanel nu il editeaza) nu mai sufera silent
// overwrite peste valoarea stocata. Cand lipseste, handler-ul preia valoarea
// existenta sau cade pe default-ul repository-ului.
// v2.13.0: dailyReportEnabled adaugat ca optional ca PUT-urile vechi (UI inca
// nedeployed) sa nu reseteze flag-ul; cand lipseste, handler-ul preia valoarea
// existenta sau cade pe `false`.
const EmailSettingsBodySchema = z
  .object({
    enabled: z.boolean(),
    toAddress: z.string().trim().email().max(320).nullable(),
    minSeverity: z.enum(["info", "warning", "critical"]).optional(),
    dailyReportEnabled: z.boolean().optional(),
  })
  .strict();

function toEmailSettingsDto(settings: EmailSettings) {
  return {
    ...settings,
    mailerConfigured: isMailerConfigured(),
  };
}

function defaultEmailSettingsForUser(ownerId: string): EmailSettings {
  const base = defaultEmailSettingsFor(ownerId);
  const user = getUserById(ownerId);
  const email = user?.email ?? "";
  if (email && email !== "local@desktop" && email.includes("@")) {
    return { ...base, toAddress: email };
  }
  return base;
}

meRouter.get("/", (c) => {
  const userId = getOwnerId(c);
  const user = getUserById(userId);
  if (user === null) {
    return c.json(fail("unauthorized", "Utilizator inexistent", c), 401);
  }
  return c.json(
    ok(
      {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role,
        status: user.status,
        createdAt: user.created_at,
        lastLoginAt: user.last_login_at,
      },
      c
    ),
    200
  );
});

meRouter.get("/email-settings", (c) => {
  const ownerId = getOwnerId(c);
  const settings = getEmailSettings(ownerId) ?? defaultEmailSettingsForUser(ownerId);
  return c.json(ok(toEmailSettingsDto(settings), c), 200);
});

meRouter.put("/email-settings", limitMeBody, async (c) => {
  const ownerId = getOwnerId(c);
  const body = await c.req.json().catch(() => null);
  const parsed = EmailSettingsBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(fail("invalid_body", "Body invalid", c, parsed.error.issues), 400);
  }
  if (parsed.data.enabled && !parsed.data.toAddress) {
    return c.json(fail("missing_to_address", "Adresa email este obligatorie cand notificarile sunt active", c), 400);
  }

  const before = getEmailSettings(ownerId);
  // v2.10.1 #1: preserve stored minSeverity if the caller didn't send it.
  const minSeverity = parsed.data.minSeverity ?? before?.minSeverity ?? "info";
  // v2.13.0: same treatment for dailyReportEnabled — preserve when omitted.
  const dailyReportEnabled = parsed.data.dailyReportEnabled ?? before?.dailyReportEnabled ?? false;
  const after = upsertEmailSettings(ownerId, {
    enabled: parsed.data.enabled,
    toAddress: parsed.data.toAddress,
    minSeverity,
    dailyReportEnabled,
  });
  recordAudit(c, "me.email_settings.update", {
    targetKind: "owner_email_settings",
    targetId: ownerId,
    detail: { before, after },
  });
  return c.json(ok(toEmailSettingsDto(after), c), 200);
});

// v2.10.1 #3: per-owner cooldown for /email-settings/test. SMTP test sends
// hit the real upstream — we don't want a stuck UI button or a malicious
// caller looping the endpoint to dispatch dozens of test emails per minute.
// 60 s is long enough to discourage abuse and short enough that a normal user
// retry after a typo isn't blocked.
const TEST_COOLDOWN_MS = 60_000;
const lastTestSendByOwner = new Map<string, number>();
export function resetEmailTestCooldownForTests(): void {
  lastTestSendByOwner.clear();
}

meRouter.post("/email-settings/test", async (c) => {
  const ownerId = getOwnerId(c);
  const settings = getEmailSettings(ownerId);
  if (!settings?.toAddress) {
    recordAudit(c, "me.email_settings.test", {
      outcome: "error",
      targetKind: "owner_email_settings",
      targetId: ownerId,
      detail: { reason: "missing_to_address" },
    });
    return c.json(fail("missing_to_address", "Salveaza intai o adresa email", c), 400);
  }
  if (!isMailerConfigured()) {
    recordAudit(c, "me.email_settings.test", {
      outcome: "error",
      targetKind: "owner_email_settings",
      targetId: ownerId,
      detail: { reason: "mailer_disabled" },
    });
    return c.json(fail("mailer_disabled", "SMTP_* nu este configurat", c), 503);
  }

  // v2.10.1 #3: per-owner cooldown.
  const now = Date.now();
  const last = lastTestSendByOwner.get(ownerId) ?? 0;
  const elapsed = now - last;
  if (elapsed < TEST_COOLDOWN_MS) {
    const retryAfterSec = Math.ceil((TEST_COOLDOWN_MS - elapsed) / 1000);
    recordAudit(c, "me.email_settings.test", {
      outcome: "denied",
      targetKind: "owner_email_settings",
      targetId: ownerId,
      detail: { reason: "cooldown", retryAfterSec },
    });
    c.header("Retry-After", String(retryAfterSec));
    return c.json(
      fail("cooldown", `Asteapta ${retryAfterSec}s inainte sa retrimiti email-ul de test`, c, { retryAfterSec }),
      429
    );
  }
  lastTestSendByOwner.set(ownerId, now);

  const result = await sendTestEmail(settings.toAddress);
  recordAudit(c, "me.email_settings.test", {
    outcome: result.ok ? "ok" : "error",
    targetKind: "owner_email_settings",
    targetId: ownerId,
    detail: result,
  });
  return c.json(ok(result, c), 200);
});

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

const EmailSettingsBodySchema = z
  .object({
    enabled: z.boolean(),
    toAddress: z.string().trim().email().max(320).nullable(),
    minSeverity: z.enum(["info", "warning", "critical"]).default("info"),
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
      c,
    ),
    200,
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
    return c.json(
      fail("missing_to_address", "Adresa email este obligatorie cand notificarile sunt active", c),
      400,
    );
  }

  const before = getEmailSettings(ownerId);
  const after = upsertEmailSettings(ownerId, parsed.data);
  recordAudit(c, "me.email_settings.update", {
    targetKind: "owner_email_settings",
    targetId: ownerId,
    detail: { before, after },
  });
  return c.json(ok(toEmailSettingsDto(after), c), 200);
});

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

  const result = await sendTestEmail(settings.toAddress);
  recordAudit(c, "me.email_settings.test", {
    outcome: result.ok ? "ok" : "error",
    targetKind: "owner_email_settings",
    targetId: ownerId,
    detail: result,
  });
  return c.json(ok(result, c), 200);
});

// v2.43.0 (rnpm-split): backup-urile MONOLITULUI (baza unica: users, auth,
// quota, monitoring, audit, fx_rates) se administreaza din Setari, admin-only.
// Inlocuieste rutele vechi de monolit din rnpm.ts — zona RNPM ramane
// self-service pe fisierele per user. requireDesktopHeader pe mutatii =
// apararea CSRF pe desktop (pass-through in web mode).

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { recordAudit, recordAuditSafe } from "../db/auditRepository.ts";
import {
  BackupValidationError,
  createManualBackup,
  deleteAllBackups,
  listBackupsWithMeta,
  restoreFromBackup,
} from "../db/backup.ts";
import { requireDesktopHeader } from "../middleware/requireDesktopHeader.ts";
import { requireRole } from "../middleware/requireRole.ts";
import { ErrorCodes, fail } from "../util/envelope.ts";

const SMALL_BODY_LIMIT = 4 * 1024;
const limitSmall = bodyLimit({
  maxSize: SMALL_BODY_LIMIT,
  onError: (c) => c.json(fail(ErrorCodes.PAYLOAD_TOO_LARGE, "Payload prea mare", c), 413),
});

export const adminBackupsRouter = new Hono();

adminBackupsRouter.use("*", requireRole("admin"));

adminBackupsRouter.get("/", async (c) => {
  try {
    const backups = await listBackupsWithMeta();
    return c.json({ backups });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Eroare listare backups";
    return c.json(fail(ErrorCodes.INTERNAL_ERROR, msg, c), 500);
  }
});

adminBackupsRouter.post("/create", requireDesktopHeader, async (c) => {
  try {
    const { name } = await createManualBackup();
    recordAuditSafe(c, "backup.create", {
      targetKind: "backup",
      targetId: name,
    });
    return c.json({ ok: true, name });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Eroare creare backup";
    recordAuditSafe(c, "backup.create", {
      targetKind: "backup",
      outcome: "error",
      detail: { error: msg },
    });
    return c.json(fail(ErrorCodes.INTERNAL_ERROR, msg, c), 500);
  }
});

adminBackupsRouter.post("/restore", requireDesktopHeader, limitSmall, async (c) => {
  const body = await c.req.json().catch(() => null);
  if (body === null) return c.json(fail(ErrorCodes.INVALID_JSON, "JSON invalid", c), 400);
  const name = (body as { name?: unknown })?.name;
  if (typeof name !== "string" || name.length === 0) {
    return c.json(fail(ErrorCodes.INVALID_PARAMS, "Nume backup lipsa", c), 400);
  }
  try {
    const { preRestoreName } = await restoreFromBackup(name);
    recordAudit(c, "backup.restore", {
      targetKind: "backup",
      targetId: name,
      detail: { preRestoreName },
    });
    return c.json({ ok: true, preRestoreName });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Eroare restore";
    recordAuditSafe(c, "backup.restore", {
      targetKind: "backup",
      targetId: name,
      outcome: "error",
      detail: { error: msg },
    });
    if (e instanceof BackupValidationError) {
      return c.json(fail(ErrorCodes.INVALID_PARAMS, msg, c), 400);
    }
    return c.json(fail(ErrorCodes.INTERNAL_ERROR, msg, c), 500);
  }
});

adminBackupsRouter.delete("/", requireDesktopHeader, async (c) => {
  try {
    const deleted = await deleteAllBackups();
    recordAuditSafe(c, "backup.delete_all", {
      targetKind: "backup",
      detail: { deleted },
    });
    return c.json({ deleted });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Eroare stergere backups";
    recordAuditSafe(c, "backup.delete_all", {
      targetKind: "backup",
      outcome: "error",
      detail: { error: msg },
    });
    return c.json(fail(ErrorCodes.INTERNAL_ERROR, msg, c), 500);
  }
});

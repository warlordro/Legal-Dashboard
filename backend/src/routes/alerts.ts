// /api/v1/alerts - owner-scoped monitoring alert feed.

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import {
  dismissAlert,
  listAlerts,
  markAlertSeen,
  subscribeToNewAlerts,
  type MonitoringAlertRow,
} from "../db/monitoringAlertsRepository.ts";
import { getOwnerId } from "../middleware/owner.ts";
import { fail, ok } from "../util/envelope.ts";

const AlertListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    jobId: z.coerce.number().int().min(1).optional(),
    kind: z
      .enum([
        "dosar_new",
        "termen_new",
        "termen_changed",
        "solutie_aparuta",
        "dosar_disappeared",
        "stadiu_changed",
        "categorie_changed",
        "dosar_relevant_now",
        "dosar_no_longer_relevant",
        "aviz_changed",
        "source_error",
      ])
      .optional(),
    severity: z.enum(["info", "warning", "critical"]).optional(),
    isNew: z
      .enum(["true", "false"])
      .transform((v) => v === "true")
      .optional(),
    onlyUnread: z
      .enum(["true", "false"])
      .transform((v) => v === "true")
      .optional(),
    dismissed: z
      .enum(["true", "false"])
      .transform((v) => v === "true")
      .optional(),
    includeDismissed: z
      .enum(["true", "false"])
      .transform((v) => v === "true")
      .optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  })
  .strict();

export const alertsRouter = new Hono();

alertsRouter.get("/", (c) => {
  const ownerId = getOwnerId(c);
  const queryResult = AlertListQuerySchema.safeParse(c.req.query());
  if (!queryResult.success) {
    return c.json(
      fail("invalid_query", "Parametri de cautare invalizi", c, queryResult.error.issues),
      400,
    );
  }

  const list = listAlerts({ ownerId, ...queryResult.data });
  return c.json(ok(list, c));
});

alertsRouter.patch("/:id/seen", (c) => {
  const ownerId = getOwnerId(c);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json(fail("invalid_id", "ID invalid", c), 400);
  }

  const row = markAlertSeen(ownerId, id);
  if (!row) {
    return c.json(fail("not_found", "Alerta inexistenta", c), 404);
  }
  return c.json(ok(row, c));
});

alertsRouter.patch("/:id/dismissed", (c) => {
  const ownerId = getOwnerId(c);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json(fail("invalid_id", "ID invalid", c), 400);
  }

  const row = dismissAlert(ownerId, id);
  if (!row) {
    return c.json(fail("not_found", "Alerta inexistenta", c), 404);
  }
  return c.json(ok(row, c));
});

alertsRouter.get("/stream", (c) => {
  const ownerId = getOwnerId(c);

  return streamSSE(c, async (stream) => {
    let unsubscribe: (() => void) | null = null;

    await stream.writeSSE({ event: "ready", data: "{}" });

    const closed = new Promise<void>((resolve) => {
      stream.onAbort(() => {
        unsubscribe?.();
        unsubscribe = null;
        resolve();
      });
    });

    unsubscribe = subscribeToNewAlerts(ownerId, (alert: MonitoringAlertRow) => {
      void stream.writeSSE({
        event: "alert",
        id: String(alert.id),
        data: JSON.stringify(alert),
      });
    });

    await closed;
  });
});

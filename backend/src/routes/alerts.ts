// /api/v1/alerts - owner-scoped monitoring alert feed.

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import { recordAudit } from "../db/auditRepository.ts";
import {
  addAlertEnrichmentListener,
  type AlertEnrichmentPayload,
  dismissAlert,
  listAlerts,
  markAlertSeen,
  markAlertsSeen,
  subscribeToNewAlerts,
  type MonitoringAlertRow,
} from "../db/monitoringAlertsRepository.ts";
import { getOwnerId } from "../middleware/owner.ts";
import { fail, ok } from "../util/envelope.ts";

// PATCH /:id/seen and /:id/dismissed both expect an empty body. 4 KiB is far
// more than enough headroom for any future "reason" field while still slamming
// the door on accidentally-large payloads from a buggy client.
const ALERT_PATCH_BODY_LIMIT = 4096;

const limitAlertPatchBody = bodyLimit({
  maxSize: ALERT_PATCH_BODY_LIMIT,
  onError: (c) => c.json(fail("payload_too_large", "Payload prea mare", c), 413),
});

// Bulk seen accepts up to 100 ids per call (same cap as listAlerts pageSize),
// at ~10 bytes per id plus JSON wrapping → ~2 KiB worst case. 8 KiB headroom.
const ALERT_BULK_BODY_LIMIT = 8192;

const limitAlertBulkBody = bodyLimit({
  maxSize: ALERT_BULK_BODY_LIMIT,
  onError: (c) => c.json(fail("payload_too_large", "Payload prea mare", c), 413),
});

const AlertBulkSeenSchema = z
  .object({
    ids: z.array(z.number().int().min(1)).min(1).max(100),
  })
  .strict();

const AlertListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    jobId: z.coerce.number().int().min(1).optional(),
    jobKind: z.enum(["dosar_soap", "name_soap", "aviz_rnpm"]).optional(),
    q: z.string().trim().min(1).max(100).optional(),
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

// TODO(PR-9): wrap with requireSession once web auth lands; desktop relies on getOwnerId('local').
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

alertsRouter.patch("/:id/seen", limitAlertPatchBody, (c) => {
  const ownerId = getOwnerId(c);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json(fail("invalid_id", "ID invalid", c), 400);
  }

  const row = markAlertSeen(ownerId, id);
  if (!row) {
    // Audit only on the success path. Auditing the 404 would let a foreign
    // tenant probe ID existence by reading their own audit_log later.
    return c.json(fail("not_found", "Alerta inexistenta", c), 404);
  }
  recordAudit(c, "alert_seen", {
    targetKind: "monitoring_alert",
    targetId: String(id),
    detail: { jobId: row.job_id, kind: row.kind },
  });
  return c.json(ok(row, c));
});

alertsRouter.patch("/:id/dismissed", limitAlertPatchBody, (c) => {
  const ownerId = getOwnerId(c);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json(fail("invalid_id", "ID invalid", c), 400);
  }

  const row = dismissAlert(ownerId, id);
  if (!row) {
    return c.json(fail("not_found", "Alerta inexistenta", c), 404);
  }
  recordAudit(c, "alert_dismissed", {
    targetKind: "monitoring_alert",
    targetId: String(id),
    detail: { jobId: row.job_id, kind: row.kind },
  });
  return c.json(ok(row, c));
});

alertsRouter.post("/seen-bulk", limitAlertBulkBody, async (c) => {
  const ownerId = getOwnerId(c);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(fail("invalid_body", "Body invalid", c), 400);
  }
  const parsed = AlertBulkSeenSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(fail("invalid_body", "Body invalid", c, parsed.error.issues), 400);
  }

  const rows = markAlertsSeen(ownerId, parsed.data.ids);
  // Audit aggregate, not per-id, to keep audit_log readable when batches are
  // large. Per-id detail is recoverable from the alert table itself if needed.
  if (rows.length > 0) {
    recordAudit(c, "alert_seen_bulk", {
      targetKind: "monitoring_alert",
      targetId: rows.map((r) => r.id).join(","),
      detail: { count: rows.length, requested: parsed.data.ids.length },
    });
  }
  return c.json(ok(rows, c));
});

alertsRouter.get("/stream", (c) => {
  const ownerId = getOwnerId(c);

  return streamSSE(c, async (stream) => {
    let unsubscribe: (() => void) | null = null;
    // F7 — separate unsubscribe for the enrichment channel. Kept distinct from
    // the new-alert unsubscribe so the new-alert subscribe-cap path (which may
    // throw and bail before we wire enrichment) doesn't have to special-case
    // a half-initialised handle.
    let unsubscribeEnriched: (() => void) | null = null;
    let heartbeat: NodeJS.Timeout | null = null;

    const stopHeartbeat = () => {
      if (heartbeat !== null) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
    };

    const cleanupSubscriptions = () => {
      unsubscribe?.();
      unsubscribe = null;
      unsubscribeEnriched?.();
      unsubscribeEnriched = null;
    };

    const closed = new Promise<void>((resolve) => {
      stream.onAbort(() => {
        stopHeartbeat();
        cleanupSubscriptions();
        resolve();
      });
    });

    // Subscribe BEFORE announcing readiness: if we wrote `ready` first, an
    // alert inserted between `await ready` and `subscribeToNewAlerts` would be
    // missed by the just-connected client even though the stream is open.
    //
    // The repo enforces a per-owner subscriber cap (5). When at cap it throws
    // — translate that into a final SSE error frame so the client can show a
    // useful message instead of a silent disconnect, then exit cleanly.
    try {
      unsubscribe = subscribeToNewAlerts(ownerId, (alert: MonitoringAlertRow) => {
        // Hono's StreamingApi.write currently swallows errors silently, so
        // this .catch is rarely entered today. Keep it as a defensive guard
        // for future Hono versions that may surface write failures, and for
        // the rare race where a network drop happens after subscribe but
        // before `onAbort` fires — in that window writeSSE could still
        // reject. Cleaning up here avoids a dead listener lingering in the
        // broadcast set.
        stream
          .writeSSE({
            event: "alert",
            id: String(alert.id),
            data: JSON.stringify(alert),
          })
          .catch((err) => {
            console.error("[alerts] writeSSE failed, dropping subscriber", err);
            stopHeartbeat();
            cleanupSubscriptions();
          });
      });
    } catch (err) {
      // Per-owner cap exceeded (or any other subscribe-time fault). Tell the
      // client what happened and bail without setting up the heartbeat or
      // wiring further state.
      console.warn("[alerts] subscribe rejected, closing stream", err);
      await stream
        .writeSSE({ event: "error", data: '{"code":"too_many_streams"}' })
        .catch(() => undefined);
      return;
    }

    // F7 — alert_enriched channel. listAlerts patches detail_json in place
    // when the runner backfills solutie_sumar / numar_document / instanta on
    // an existing alert; the inbox needs to see that mutation without a
    // manual reload. The repository already partitions listeners per owner,
    // but we double-check the payload's ownerId here so a future refactor
    // (e.g. switching to a global listener bus) can't accidentally cross
    // tenants. No subscriber cap on this channel — it shares the same
    // EventSource handle as the new-alert subscription, so it's already
    // bounded by the per-owner SSE-stream cap (5).
    unsubscribeEnriched = addAlertEnrichmentListener(
      ownerId,
      (payload: AlertEnrichmentPayload) => {
        if (payload.ownerId !== ownerId) return;
        stream
          .writeSSE({
            event: "alert_enriched",
            id: String(payload.id),
            data: JSON.stringify({
              id: payload.id,
              jobId: payload.jobId,
              detail: payload.detail,
            }),
          })
          .catch((err) => {
            console.error(
              "[alerts] enrichment writeSSE failed, dropping subscriber",
              err,
            );
            stopHeartbeat();
            cleanupSubscriptions();
          });
      },
    );

    // First event carries `retry: 3000` so EventSource clients reconnect
    // after 3s on disconnect (browser default is unspecified by the spec —
    // pinning it makes reconnect behaviour deterministic across user agents).
    await stream.writeSSE({ event: "ready", data: "{}", retry: 3000 });

    // Heartbeat: NAT/proxy hops drop idle TCP after ~60s. A 25s ping is well
    // inside common idle thresholds and cheap (~30 bytes). Cleared in three
    // places: onAbort, writeSSE failure path, and the final fall-through
    // after `await closed` resolves.
    heartbeat = setInterval(() => {
      stream.writeSSE({ event: "ping", data: "{}" }).catch((err) => {
        console.error("[alerts] heartbeat writeSSE failed, dropping subscriber", err);
        stopHeartbeat();
        cleanupSubscriptions();
      });
    }, 25_000);

    await closed;
    stopHeartbeat();
  });
});

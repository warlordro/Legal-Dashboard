// /api/v1/alerts - owner-scoped monitoring alert feed.

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import { recordAudit } from "../db/auditRepository.ts";
import {
  addAlertEnrichmentListener,
  ALERT_JOB_KINDS,
  ALERT_KINDS,
  ALERT_SEVERITIES,
  type AlertEnrichmentPayload,
  dismissAlert,
  dismissAlertsByIds,
  listAlerts,
  listAlertsByIds,
  markAlertSeen,
  markAlertUnseen,
  markAlertsSeen,
  selectAlertIdsByFilters,
  subscribeToNewAlerts,
  type MonitoringAlertRow,
} from "../db/monitoringAlertsRepository.ts";
import { getDb } from "../db/schema.ts";
import { deriveAlertDigestRow } from "../services/email/dailyReportTemplate.ts";
import { buildAlertsPdf } from "../services/alertsExportPdf.ts";
import { buildAlertsXlsx, type AlertExportDecoratedRow } from "../services/alertsExportXlsx.ts";
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

// v2.13.0: export endpoint accepta trei moduri exclusive:
//   - mode "ids": selectie explicita (Selecteaza randuri pe pagina, max 10k)
//   - mode "filters": aceleasi query params ca GET / (Toate filtrele active)
//   - mode "range": doar interval de date (subset al "filters")
// Cap fix la 10k randuri pentru a nu suprasolicita memoria browser-ului in
// renderingul XLSX/PDF. Daca total depaseste, returnam 413 cu count-ul real
// ca user-ul sa stranga filtrele.
const ALERT_EXPORT_MAX_ROWS = 10_000;
const ALERT_EXPORT_BODY_LIMIT = 256 * 1024;
const limitAlertExportBody = bodyLimit({
  maxSize: ALERT_EXPORT_BODY_LIMIT,
  onError: (c) => c.json(fail("payload_too_large", "Payload prea mare", c), 413),
});

const AlertExportFiltersSchema = z
  .object({
    jobKind: z.enum(ALERT_JOB_KINDS).optional(),
    q: z.string().trim().min(1).max(100).optional(),
    kind: z.enum(ALERT_KINDS).optional(),
    severity: z.enum(ALERT_SEVERITIES).optional(),
    onlyUnread: z.boolean().optional(),
    includeDismissed: z.boolean().optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  })
  .strict();

const AlertExportBodySchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("ids"),
      ids: z.array(z.number().int().min(1)).min(1).max(ALERT_EXPORT_MAX_ROWS),
    })
    .strict(),
  z
    .object({
      mode: z.literal("filters"),
      filters: AlertExportFiltersSchema.optional().default({}),
    })
    .strict(),
  z
    .object({
      mode: z.literal("range"),
      from: z.string().datetime(),
      to: z.string().datetime(),
    })
    .strict(),
]);

const AlertListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    jobId: z.coerce.number().int().min(1).optional(),
    jobKind: z.enum(ALERT_JOB_KINDS).optional(),
    q: z.string().trim().min(1).max(100).optional(),
    kind: z.enum(ALERT_KINDS).optional(),
    severity: z.enum(ALERT_SEVERITIES).optional(),
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
    return c.json(fail("invalid_query", "Parametri de cautare invalizi", c, queryResult.error.issues), 400);
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

  // v2.17.0 — wrap mutation + audit in a single transaction so an audit
  // failure rolls back the seen flip. better-sqlite3 nests via SAVEPOINTs:
  // markAlertSeen's inner transaction becomes a savepoint inside this one,
  // so the lock is acquired once at the outer boundary.
  const row = getDb().transaction(() => {
    const updated = markAlertSeen(ownerId, id);
    if (!updated) return null;
    recordAudit(c, "alert_seen", {
      targetKind: "monitoring_alert",
      targetId: String(id),
      detail: { jobId: updated.job_id, kind: updated.kind },
    });
    return updated;
  })();

  if (!row) {
    // Audit only on the success path. Auditing the 404 would let a foreign
    // tenant probe ID existence by reading their own audit_log later.
    return c.json(fail("not_found", "Alerta inexistenta", c), 404);
  }
  return c.json(ok(row, c));
});

alertsRouter.patch("/:id/unseen", limitAlertPatchBody, (c) => {
  const ownerId = getOwnerId(c);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json(fail("invalid_id", "ID invalid", c), 400);
  }

  const row = getDb().transaction(() => {
    const updated = markAlertUnseen(ownerId, id);
    if (!updated) return null;
    recordAudit(c, "alert_unseen", {
      targetKind: "monitoring_alert",
      targetId: String(id),
      detail: { jobId: updated.job_id, kind: updated.kind },
    });
    return updated;
  })();

  if (!row) {
    return c.json(fail("not_found", "Alerta inexistenta", c), 404);
  }
  return c.json(ok(row, c));
});

alertsRouter.patch("/:id/dismissed", limitAlertPatchBody, (c) => {
  const ownerId = getOwnerId(c);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json(fail("invalid_id", "ID invalid", c), 400);
  }

  const row = getDb().transaction(() => {
    const updated = dismissAlert(ownerId, id);
    if (!updated) return null;
    recordAudit(c, "alert_dismissed", {
      targetKind: "monitoring_alert",
      targetId: String(id),
      detail: { jobId: updated.job_id, kind: updated.kind },
    });
    return updated;
  })();

  if (!row) {
    return c.json(fail("not_found", "Alerta inexistenta", c), 404);
  }
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

// v2.14.0 — bulk dismiss (Inchide selectia / Inchide toate cele filtrate).
//
// Doua moduri exclusive (mirror al /export):
//   - mode "ids":     selectia explicita (max 10k id-uri).
//   - mode "filters": filtrele active din toolbar — exact aceleasi keys ca
//                     GET /. `includeDismissed` e respins server-side: a-l
//                     accepta ar transforma "Inchide toate" intr-un no-op
//                     pe alerte deja inchise si ar leaks o operatie
//                     fara semantica utila. UI-ul dezactiveaza butonul cand
//                     filtrul e activ.
// Cap fix la 10k randuri. Daca filtrul matche peste, returnam 413 cu total-ul
// real ca user-ul sa restranga filtrele inainte sa apese din nou.
const ALERT_DISMISS_BULK_MAX_ROWS = 10_000;
const ALERT_DISMISS_BULK_BODY_LIMIT = 256 * 1024;
const limitAlertDismissBulkBody = bodyLimit({
  maxSize: ALERT_DISMISS_BULK_BODY_LIMIT,
  onError: (c) => c.json(fail("payload_too_large", "Payload prea mare", c), 413),
});

const AlertDismissBulkFiltersSchema = z
  .object({
    jobKind: z.enum(ALERT_JOB_KINDS).optional(),
    q: z.string().trim().min(1).max(100).optional(),
    kind: z.enum(ALERT_KINDS).optional(),
    severity: z.enum(ALERT_SEVERITIES).optional(),
    onlyUnread: z.boolean().optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  })
  .strict();

const AlertDismissBulkBodySchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("ids"),
      ids: z.array(z.number().int().min(1)).min(1).max(ALERT_DISMISS_BULK_MAX_ROWS),
    })
    .strict(),
  z
    .object({
      mode: z.literal("filters"),
      filters: AlertDismissBulkFiltersSchema.optional().default({}),
    })
    .strict(),
]);

alertsRouter.post("/dismiss-bulk", limitAlertDismissBulkBody, async (c) => {
  const ownerId = getOwnerId(c);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(fail("invalid_body", "Body invalid", c), 400);
  }
  const parsed = AlertDismissBulkBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(fail("invalid_body", "Body invalid", c, parsed.error.issues), 400);
  }

  let result: { dismissedCount: number; alreadyDismissedCount: number; totalMatched: number };
  if (parsed.data.mode === "ids") {
    result = dismissAlertsByIds(ownerId, parsed.data.ids);
  } else {
    const f = parsed.data.filters;
    // Probe count first via listAlerts (consistent with /export shape) and
    // refuse early if matched > cap. listAlerts excludes dismissed by default,
    // which is what we want — already-dismissed alerts must not inflate the
    // count or trigger 413.
    const probe = listAlerts({
      ownerId,
      page: 1,
      pageSize: 1,
      jobKind: f.jobKind,
      q: f.q,
      kind: f.kind,
      severity: f.severity,
      onlyUnread: f.onlyUnread,
      from: f.from,
      to: f.to,
    });
    if (probe.total > ALERT_DISMISS_BULK_MAX_ROWS) {
      return c.json(
        fail(
          "too_many_rows",
          `Operatia depaseste limita de ${ALERT_DISMISS_BULK_MAX_ROWS} alerte (matched: ${probe.total}). Restrange filtrele.`,
          c,
          { total: probe.total, max: ALERT_DISMISS_BULK_MAX_ROWS }
        ),
        413
      );
    }
    const ids = selectAlertIdsByFilters(
      {
        ownerId,
        jobKind: f.jobKind,
        q: f.q,
        kind: f.kind,
        severity: f.severity,
        onlyUnread: f.onlyUnread,
        from: f.from,
        to: f.to,
      },
      ALERT_DISMISS_BULK_MAX_ROWS
    );
    result = dismissAlertsByIds(ownerId, ids);
  }

  // Audit aggregate cu mode + count, NU id-urile. Pentru bulk-uri de mii de
  // randuri, scrierea id-urilor in audit_log inflate-aza tabela fara beneficiu
  // — randurile in sine raman recuperabile prin (owner_id, dismissed_at).
  recordAudit(c, "alerts.dismiss_bulk", {
    targetKind: "monitoring_alert",
    targetId: String(result.totalMatched),
    detail: {
      mode: parsed.data.mode,
      dismissed: result.dismissedCount,
      alreadyDismissed: result.alreadyDismissedCount,
      totalMatched: result.totalMatched,
    },
  });

  return c.json(ok(result, c));
});

alertsRouter.post("/export", limitAlertExportBody, async (c) => {
  const ownerId = getOwnerId(c);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(fail("invalid_body", "Body invalid", c), 400);
  }
  const parsed = AlertExportBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(fail("invalid_body", "Body invalid", c, parsed.error.issues), 400);
  }

  let rows: MonitoringAlertRow[] = [];
  if (parsed.data.mode === "ids") {
    rows = listAlertsByIds(ownerId, parsed.data.ids);
  } else if (parsed.data.mode === "filters") {
    const f = parsed.data.filters;
    // First pass: count via listAlerts pageSize=1 to detect cap overflow before
    // pulling the full result set into memory. listAlerts returns total even
    // when pageSize is small, so this stays cheap.
    const probe = listAlerts({
      ownerId,
      page: 1,
      pageSize: 1,
      jobKind: f.jobKind,
      q: f.q,
      kind: f.kind,
      severity: f.severity,
      onlyUnread: f.onlyUnread,
      includeDismissed: f.includeDismissed,
      from: f.from,
      to: f.to,
    });
    if (probe.total > ALERT_EXPORT_MAX_ROWS) {
      return c.json(
        fail(
          "too_many_rows",
          `Exportul depaseste limita de ${ALERT_EXPORT_MAX_ROWS} randuri (rezultat: ${probe.total}). Restrange filtrele.`,
          c,
          { total: probe.total, max: ALERT_EXPORT_MAX_ROWS }
        ),
        413
      );
    }
    const full = listAlerts({
      ownerId,
      page: 1,
      pageSize: ALERT_EXPORT_MAX_ROWS,
      jobKind: f.jobKind,
      q: f.q,
      kind: f.kind,
      severity: f.severity,
      onlyUnread: f.onlyUnread,
      includeDismissed: f.includeDismissed,
      from: f.from,
      to: f.to,
    });
    rows = full.rows;
  } else {
    // mode === "range"
    const probe = listAlerts({
      ownerId,
      page: 1,
      pageSize: 1,
      from: parsed.data.from,
      to: parsed.data.to,
      includeDismissed: true,
    });
    if (probe.total > ALERT_EXPORT_MAX_ROWS) {
      return c.json(
        fail(
          "too_many_rows",
          `Exportul depaseste limita de ${ALERT_EXPORT_MAX_ROWS} randuri (rezultat: ${probe.total}). Restrange intervalul.`,
          c,
          { total: probe.total, max: ALERT_EXPORT_MAX_ROWS }
        ),
        413
      );
    }
    const full = listAlerts({
      ownerId,
      page: 1,
      pageSize: ALERT_EXPORT_MAX_ROWS,
      from: parsed.data.from,
      to: parsed.data.to,
      includeDismissed: true,
    });
    rows = full.rows;
  }

  // Decorate with derived numar_dosar + dosarLink so the frontend doesn't
  // need to re-implement detail/target parsing for hyperlink cells. The raw
  // row is preserved in `alert` so consumers that want full structure (e.g.
  // future webhook export) still have it.
  const decorated = rows.map((alert) => {
    const derived = deriveAlertDigestRow(alert);
    return {
      alert,
      numarDosar: derived.numarDosar,
      dosarLink: derived.dosarLink,
      kindLabel: derived.kindLabel,
      severityLabel: derived.severityLabel,
      nameMonitored: derived.nameMonitored,
    };
  });

  recordAudit(c, "alerts.export", {
    targetKind: "monitoring_alert",
    targetId: String(rows.length),
    detail: { mode: parsed.data.mode, count: rows.length },
  });

  return c.json(ok({ rows: decorated, count: decorated.length }, c));
});

function exportContextLabel(c: import("hono").Context): string | undefined {
  const value = c.req.header("x-export-context-label")?.trim();
  return value && value.length <= 120 ? value : undefined;
}

async function collectAlertExportRows(c: import("hono").Context) {
  const ownerId = getOwnerId(c);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return { error: c.json(fail("invalid_body", "Body invalid", c), 400) };
  }
  const parsed = AlertExportBodySchema.safeParse(body);
  if (!parsed.success) {
    return { error: c.json(fail("invalid_body", "Body invalid", c, parsed.error.issues), 400) };
  }

  let rows: MonitoringAlertRow[] = [];
  if (parsed.data.mode === "ids") {
    rows = listAlertsByIds(ownerId, parsed.data.ids);
  } else if (parsed.data.mode === "filters") {
    const f = parsed.data.filters;
    const probe = listAlerts({
      ownerId,
      page: 1,
      pageSize: 1,
      jobKind: f.jobKind,
      q: f.q,
      kind: f.kind,
      severity: f.severity,
      onlyUnread: f.onlyUnread,
      includeDismissed: f.includeDismissed,
      from: f.from,
      to: f.to,
    });
    if (probe.total > ALERT_EXPORT_MAX_ROWS) {
      return {
        error: c.json(
          fail(
            "too_many_rows",
            `Exportul depaseste limita de ${ALERT_EXPORT_MAX_ROWS} randuri (rezultat: ${probe.total}). Restrange filtrele.`,
            c,
            { total: probe.total, max: ALERT_EXPORT_MAX_ROWS }
          ),
          413
        ),
      };
    }
    rows = listAlerts({
      ownerId,
      page: 1,
      pageSize: ALERT_EXPORT_MAX_ROWS,
      jobKind: f.jobKind,
      q: f.q,
      kind: f.kind,
      severity: f.severity,
      onlyUnread: f.onlyUnread,
      includeDismissed: f.includeDismissed,
      from: f.from,
      to: f.to,
    }).rows;
  } else {
    const probe = listAlerts({
      ownerId,
      page: 1,
      pageSize: 1,
      from: parsed.data.from,
      to: parsed.data.to,
      includeDismissed: true,
    });
    if (probe.total > ALERT_EXPORT_MAX_ROWS) {
      return {
        error: c.json(
          fail(
            "too_many_rows",
            `Exportul depaseste limita de ${ALERT_EXPORT_MAX_ROWS} randuri (rezultat: ${probe.total}). Restrange intervalul.`,
            c,
            { total: probe.total, max: ALERT_EXPORT_MAX_ROWS }
          ),
          413
        ),
      };
    }
    rows = listAlerts({
      ownerId,
      page: 1,
      pageSize: ALERT_EXPORT_MAX_ROWS,
      from: parsed.data.from,
      to: parsed.data.to,
      includeDismissed: true,
    }).rows;
  }

  if (rows.length === 0) {
    return { error: c.json(fail("not_found", "Nicio alerta de exportat pentru selectia/intervalul ales.", c), 404) };
  }

  const decorated: AlertExportDecoratedRow[] = rows.map((alert) => {
    const derived = deriveAlertDigestRow(alert);
    return {
      alert,
      numarDosar: derived.numarDosar,
      dosarLink: derived.dosarLink,
      kindLabel: derived.kindLabel,
      severityLabel: derived.severityLabel,
      nameMonitored: derived.nameMonitored,
    };
  });

  recordAudit(c, "alerts.export", {
    targetKind: "monitoring_alert",
    targetId: String(rows.length),
    detail: { mode: parsed.data.mode, count: rows.length },
  });

  return { rows: decorated };
}

async function streamExportResult(
  c: import("hono").Context,
  result: { filepath: string; filename: string; mime: string; byteLength: number }
) {
  const [{ createReadStream }, { unlink }, { Readable }] = await Promise.all([
    import("node:fs"),
    import("node:fs/promises"),
    import("node:stream"),
  ]);
  const fileStream = createReadStream(result.filepath);
  fileStream.once("close", () => {
    void unlink(result.filepath).catch(() => {});
  });
  const safeAscii = result.filename.replace(/[^A-Za-z0-9._-]+/g, "_");
  c.header("Content-Type", result.mime);
  c.header("Content-Length", String(result.byteLength));
  c.header(
    "Content-Disposition",
    `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`
  );
  c.header("Cache-Control", "no-store");
  return c.body(Readable.toWeb(fileStream) as unknown as ReadableStream);
}

alertsRouter.post("/export.xlsx", limitAlertExportBody, async (c) => {
  const collected = await collectAlertExportRows(c);
  if ("error" in collected) return collected.error;
  const result = await buildAlertsXlsx(collected.rows, exportContextLabel(c));
  return streamExportResult(c, result);
});

alertsRouter.post("/export.pdf", limitAlertExportBody, async (c) => {
  const collected = await collectAlertExportRows(c);
  if ("error" in collected) return collected.error;
  const result = await buildAlertsPdf(collected.rows, exportContextLabel(c));
  return streamExportResult(c, result);
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
      await stream.writeSSE({ event: "error", data: '{"code":"too_many_streams"}' }).catch(() => undefined);
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
    unsubscribeEnriched = addAlertEnrichmentListener(ownerId, (payload: AlertEnrichmentPayload) => {
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
          console.error("[alerts] enrichment writeSSE failed, dropping subscriber", err);
          stopHeartbeat();
          cleanupSubscriptions();
        });
    });

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

// /api/v1/monitoring/jobs — CRUD for the PR-3 monitoring core.
//
// Wire format: standard envelope (`{data, error?, requestId}`). Validation:
// Zod schemas at the boundary; success path delegates to monitoringJobsRepo.
// Mutations write audit_log entries via recordAudit() so admin / web mode
// later has a full action trail.
//
// All handlers are owner-scoped: a PATCH/DELETE on someone else's job returns
// 404 (not 403) — leaking ownership existence to the requester is itself a
// signal we don't want to give.

import { Hono } from "hono";
import { ZodError } from "zod";

import { getOwnerId } from "../middleware/owner.ts";
import { recordAudit } from "../db/auditRepository.ts";
import {
  createJob,
  deleteJob,
  getJobById,
  listJobs,
  updateJob,
} from "../db/monitoringJobsRepository.ts";
import { getDb } from "../db/schema.ts";
import {
  JobCreateBodySchema,
  JobListQuerySchema,
  JobUpdateBodySchema,
} from "../schemas/monitoring.ts";
import { fail, ok } from "../util/envelope.ts";

export const monitoringRouter = new Hono();

// GET /jobs?page=1&pageSize=20&kind=dosar_soap&active=true
monitoringRouter.get("/jobs", (c) => {
  const ownerId = getOwnerId(c);
  const queryResult = JobListQuerySchema.safeParse(c.req.query());
  if (!queryResult.success) {
    return c.json(
      fail("invalid_query", "Parametri de cautare invalizi", c, queryResult.error.issues),
      400,
    );
  }
  const list = listJobs({ ownerId, ...queryResult.data });
  return c.json(ok(list, c));
});

// GET /jobs/:id
monitoringRouter.get("/jobs/:id", (c) => {
  const ownerId = getOwnerId(c);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json(fail("invalid_id", "ID invalid", c), 400);
  }
  const row = getJobById(ownerId, id);
  if (!row) {
    return c.json(fail("not_found", "Job inexistent", c), 404);
  }
  return c.json(ok(row, c));
});

// POST /jobs
monitoringRouter.post("/jobs", async (c) => {
  const ownerId = getOwnerId(c);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(fail("invalid_json", "Body JSON invalid", c), 400);
  }

  const parsed = JobCreateBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(fail("invalid_payload", "Payload invalid", c, parsed.error.issues), 422);
  }

  // Wrap the insert + audit write in a single transaction so a partial
  // failure can't produce a job without a corresponding audit row (or vice
  // versa). better-sqlite3 transactions are synchronous; the route handler is
  // async only on c.req.json() above, which is already resolved here.
  let result: ReturnType<typeof createJob>;
  try {
    result = getDb().transaction(() => {
      const r = createJob({ ownerId, body: parsed.data });
      // Audit only on actual mutation. An idempotent replay (same
      // client_request_id) or a target_hash collision both return the
      // existing row — they're not new events worth a row in audit_log.
      if (!r.duplicate) {
        recordAudit(c, "monitoring.job.created", {
          targetKind: "monitoring_job",
          targetId: String(r.job.id),
          detail: { kind: r.job.kind, target_hash: r.job.target_hash },
        });
      }
      return r;
    })();
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json(fail("invalid_payload", "Payload invalid", c, err.issues), 422);
    }
    console.error("[monitoring] createJob failed:", err);
    return c.json(fail("internal_error", "Eroare la salvarea jobului", c), 500);
  }

  // 201 on fresh insert, 200 on idempotent replay (REST convention).
  const status = result.duplicate ? 200 : 201;
  return c.json(ok(result.job, c), status);
});

// PATCH /jobs/:id
monitoringRouter.patch("/jobs/:id", async (c) => {
  const ownerId = getOwnerId(c);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json(fail("invalid_id", "ID invalid", c), 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(fail("invalid_json", "Body JSON invalid", c), 400);
  }

  const parsed = JobUpdateBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(fail("invalid_payload", "Payload invalid", c, parsed.error.issues), 422);
  }

  // Atomic: update + audit committed together. updateJob already opens its
  // own internal transaction; better-sqlite3 nests cleanly via SAVEPOINT, so
  // the outer wrap simply scopes the audit row to the same commit boundary.
  const updated = getDb().transaction(() => {
    const u = updateJob(ownerId, id, parsed.data);
    if (!u) return null;
    recordAudit(c, "monitoring.job.updated", {
      targetKind: "monitoring_job",
      targetId: String(id),
      detail: { fields: Object.keys(parsed.data) },
    });
    return u;
  })();

  if (!updated) {
    return c.json(fail("not_found", "Job inexistent", c), 404);
  }

  return c.json(ok(updated, c));
});

// DELETE /jobs/:id
monitoringRouter.delete("/jobs/:id", (c) => {
  const ownerId = getOwnerId(c);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json(fail("invalid_id", "ID invalid", c), 400);
  }
  const deleted = getDb().transaction(() => {
    const d = deleteJob(ownerId, id);
    if (!d) return false;
    recordAudit(c, "monitoring.job.deleted", {
      targetKind: "monitoring_job",
      targetId: String(id),
    });
    return true;
  })();

  if (!deleted) {
    return c.json(fail("not_found", "Job inexistent", c), 404);
  }
  return c.json(ok({ deleted: true }, c));
});

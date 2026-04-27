import type { Context, Next } from "hono";

// Per-request correlation id. Stored in the Hono context and surfaced on every
// envelope response (`{data, error?, requestId}`) plus audit_log writes
// downstream, so a 4xx/5xx in the UI maps back to a single server-side log
// trail without hand-correlating timestamps.
//
// We accept an inbound `x-request-id` header so callers (e.g., a future load
// balancer that already mints one) can propagate their own value. If absent or
// malformed we generate a fresh UUID v4 via crypto.randomUUID().

declare module "hono" {
  interface ContextVariableMap {
    requestId: string;
  }
}

const VALID_RID = /^[A-Za-z0-9_\-]{8,128}$/;

export async function requestIdContext(c: Context, next: Next): Promise<void> {
  const inbound = c.req.header("x-request-id");
  const id = inbound && VALID_RID.test(inbound) ? inbound : crypto.randomUUID();
  c.set("requestId", id);
  c.header("x-request-id", id);
  await next();
}

export function getRequestId(c: Context): string {
  return c.get("requestId") ?? "";
}

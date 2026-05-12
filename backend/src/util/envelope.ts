// Standard JSON response envelope for v1 routers (PR-3+).
//
// Shape: { data, error?: { code, message, details? }, requestId }
// PLAN §6 documents this contract. Callers either:
//   - return c.json(ok(data, c), 200)
//   - return c.json(fail(code, message, c, { details, status }), status)
//
// Why an envelope: API routes need a discriminator the frontend can read
// without inspecting HTTP status alone (proxies sometimes mangle status; in
// the future an aggregator may bundle multiple sub-responses). Keeping
// requestId in the body means the UI can echo it in error toasts so users
// can paste a single id when reporting bugs.
//
// Legacy non-envelope routes (dosare, termene, rnpm, ai) intentionally remain
// as-is — those are pre-PR-3 and rewriting them is out of scope until PR-6
// (`@hono/zod-openapi` adoption) standardizes everything.

import type { Context } from "hono";
import { getRequestId } from "../middleware/requestId.ts";

export interface EnvelopeOk<T> {
  data: T;
  requestId: string;
}

export interface EnvelopeError {
  data: null;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId: string;
}

export function ok<T>(data: T, c: Context): EnvelopeOk<T> {
  return { data, requestId: getRequestId(c) };
}

export function fail(code: string, message: string, c: Context, details?: unknown): EnvelopeError {
  const error: EnvelopeError["error"] = { code, message };
  if (details !== undefined) error.details = details;
  return { data: null, error, requestId: getRequestId(c) };
}

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

export const ErrorCodes = {
  INVALID_JSON: "INVALID_JSON",
  INVALID_PARAMS: "INVALID_PARAMS",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  INVALID_CAPTCHA_KEY: "INVALID_CAPTCHA_KEY",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  LIMIT_EXCEEDED: "LIMIT_EXCEEDED",
  DUPLICATE_REQUEST: "DUPLICATE_REQUEST",
  CAPTCHA_BALANCE_UNAVAILABLE: "CAPTCHA_BALANCE_UNAVAILABLE",
  INSUFFICIENT_FUNDS: "INSUFFICIENT_FUNDS",
  FILTER_DISABLED: "FILTER_DISABLED",
  FILTER_TIMEOUT: "FILTER_TIMEOUT",
  MISSING_API_KEY: "MISSING_API_KEY",
  UNKNOWN_MODEL: "UNKNOWN_MODEL",
  AI_ANALYSIS_FAILED: "AI_ANALYSIS_FAILED",
  WEB_MODE_NOT_IMPLEMENTED: "WEB_MODE_NOT_IMPLEMENTED",
  QUOTA_EXCEEDED: "QUOTA_EXCEEDED",
  CAPTCHA_NOT_CONFIGURED: "CAPTCHA_NOT_CONFIGURED",
  DESKTOP_ONLY: "DESKTOP_ONLY",
  NOT_FOUND: "NOT_FOUND",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  // PAT (piesa A). NB: 401-ul PAT emite lowercase `invalid_token` prin
  // AuthenticationError (house style), NU un cod din acest enum. 403/429 = uppercase aici.
  PAT_ROUTE_FORBIDDEN: "PAT_ROUTE_FORBIDDEN",
  INSUFFICIENT_SCOPE: "INSUFFICIENT_SCOPE",
  PAT_CANNOT_MANAGE_TOKENS: "PAT_CANNOT_MANAGE_TOKENS",
  ICCJ_UNAVAILABLE: "ICCJ_UNAVAILABLE",
  // v2.43.x (C1): coduri de concurenta/mentenanta emise de rutele de backup
  // si handlerul central. COOLDOWN/DESKTOP_HEADER_REQUIRED raman lowercase pe
  // sarma — clientii existenti le compara ca stringuri.
  SEARCH_ACTIVE: "SEARCH_ACTIVE",
  RESTORE_IN_PROGRESS: "RESTORE_IN_PROGRESS",
  MAINTENANCE_SHUTDOWN: "MAINTENANCE_SHUTDOWN",
  COOLDOWN: "cooldown",
  DESKTOP_HEADER_REQUIRED: "desktop_header_required",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

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

export function fail(code: ErrorCode | string, message: string, c: Context, details?: unknown): EnvelopeError {
  const error: EnvelopeError["error"] = { code, message };
  if (details !== undefined) error.details = details;
  return { data: null, error, requestId: getRequestId(c) };
}

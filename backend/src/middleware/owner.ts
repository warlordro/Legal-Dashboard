import type { Context, Next } from "hono";

// Type-augment Hono so c.get("ownerId") is typed string instead of unknown.
// Single source of truth for the variable name; route handlers and repositories
// never duplicate the literal.
declare module "hono" {
  interface ContextVariableMap {
    ownerId: string;
  }
}

// PR-1 seam: every request gets an owner_id in context. On desktop and during
// Faza 1 (PR-0..PR-7) this is always "local". PR-9 will replace the assignment
// with the JWT-derived user id (and reject unauthenticated requests where the
// future requireAuth middleware leaves the variable unset).
export async function ownerContext(c: Context, next: Next): Promise<void> {
  c.set("ownerId", "local");
  await next();
}

// Helper consumed by new routes (PR-3+) and any handler migrated to the seam.
// Reads the value populated by ownerContext; falls back to "local" so a missing
// middleware mount still yields desktop-correct behavior instead of throwing.
// PR-9 will tighten this to: throw / 401 when c.get("ownerId") is unset in
// web mode (APP_MODE !== "desktop").
export function getOwnerId(c: Context): string {
  return c.get("ownerId") ?? "local";
}

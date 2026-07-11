// v2.43.0 (rnpm-split): error-handler global montat cu app.onError. Plasa de
// siguranta pentru erorile de concurenta RNPM aruncate din straturi adanci
// (inclusiv latch-ul de restore din getRnpmDb) pe cai care nu au gard explicit
// la nivel de ruta — clientul primeste envelope 409, nu un 500 generic.
// Restul erorilor pastreaza comportamentul default Hono (HTTPException
// pass-through; altfel 500 text).

import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { fail } from "./envelope.ts";

// Fix review (Task 4.3/5.2): rutele cu catch GENERIC apeleaza helper-ul la
// clasificarea erorii — erorile tipate de concurenta/shutdown se rethrow-uiesc
// spre handlerul central (409/503 mai jos) in loc sa fie inghitite intr-un
// 500 generic (care ar face 409/503-ul de design inaccesibil clientului).
const TYPED_MAINTENANCE_CODES = new Set(["RESTORE_IN_PROGRESS", "SEARCH_ACTIVE", "MAINTENANCE_SHUTDOWN"]);

export function rethrowTypedMaintenanceError(err: unknown): void {
  const code = (err as { code?: unknown })?.code;
  if (typeof code === "string" && TYPED_MAINTENANCE_CODES.has(code)) throw err as Error;
}

// B1: acelasi test de clasificare, fara efectul de rethrow — folosit de
// rutele care trebuie sa scrie audit outcome="denied" (nu "error") PE eroarea
// tipata inainte de a o retrimite spre handlerul central.
export function isTypedMaintenanceError(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  return typeof code === "string" && TYPED_MAINTENANCE_CODES.has(code);
}

export function appErrorHandler(err: Error, c: Context): Response {
  const code = (err as { code?: unknown }).code;
  if (code === "RESTORE_IN_PROGRESS" || code === "SEARCH_ACTIVE") {
    return c.json(fail(code, err.message, c), 409);
  }
  // Fix review (Task 4): scrierile de mentenanta refuzate la shutdown primesc
  // 503 + Retry-After (clientul reincearca dupa repornire), nu 500 generic.
  if (code === "MAINTENANCE_SHUTDOWN") {
    c.header("Retry-After", "10");
    return c.json(fail(code, err.message, c), 503);
  }
  if (err instanceof HTTPException) return err.getResponse();
  console.error("[app] unhandled route error:", err);
  return c.text("Internal Server Error", 500);
}

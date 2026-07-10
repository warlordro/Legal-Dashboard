// v2.43.0 (rnpm-split): error-handler global montat cu app.onError. Plasa de
// siguranta pentru erorile de concurenta RNPM aruncate din straturi adanci
// (inclusiv latch-ul de restore din getRnpmDb) pe cai care nu au gard explicit
// la nivel de ruta — clientul primeste envelope 409, nu un 500 generic.
// Restul erorilor pastreaza comportamentul default Hono (HTTPException
// pass-through; altfel 500 text).

import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { fail } from "./envelope.ts";

export function appErrorHandler(err: Error, c: Context): Response {
  const code = (err as { code?: unknown }).code;
  if (code === "RESTORE_IN_PROGRESS" || code === "SEARCH_ACTIVE") {
    return c.json(fail(code, err.message, c), 409);
  }
  if (err instanceof HTTPException) return err.getResponse();
  console.error("[app] unhandled route error:", err);
  return c.text("Internal Server Error", 500);
}

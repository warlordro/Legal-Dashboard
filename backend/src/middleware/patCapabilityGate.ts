import type { Context, Next } from "hono";
import { ErrorCodes, fail } from "../util/envelope.ts";

// Single source of truth: ce poate atinge un PAT. Default-deny in afara listei.
// Doar citire: GET + POST-urile de cautare verificate. ATENTIE (fix review PAT-001):
// RNPM search e POST; ICCJ search (dosare-iccj/termene-iccj) e GET. Revizuieste la
// FIECARE ruta noua.
// `exact: true` = potrivire pe path EXACT (nu prefix de segment). GET-urile raman prefix
// (ca sa acopere sub-rute read-only de detaliu, ex. /dosare-iccj/detaliu/:id, /rnpm/saved/:id).
export const PAT_CAPABILITIES: ReadonlyArray<{ method: string; prefix: string; scope: string; exact?: boolean }> = [
  { method: "GET", prefix: "/api/dosare", scope: "dosare" },
  { method: "GET", prefix: "/api/termene", scope: "dosare" },
  { method: "GET", prefix: "/api/dosare-iccj", scope: "iccj" },
  { method: "GET", prefix: "/api/termene-iccj", scope: "iccj" },
  // runda 4: exact — POST se potriveste DOAR pe ruta de cautare, NU pe sub-rute (ex.
  // POST /api/rnpm/search/:searchId/filter, care opereaza pe o sesiune de cautare existenta,
  // nu e endpoint-ul de cautare intentionat). Fara exact, un PAT rnpm ar ajunge la ele.
  { method: "POST", prefix: "/api/rnpm/search", scope: "rnpm", exact: true },
  { method: "GET", prefix: "/api/rnpm/saved", scope: "rnpm" },
];

// Match pe granita de segment, case-insensitiv, trailing-slash canonic:
// "/api/dosare" NU acopera "/api/dosare-iccj"; "/api/dosare/" == "/api/dosare".
function normPath(p: string): string {
  const lower = p.toLowerCase();
  return lower.length > 1 && lower.endsWith("/") ? lower.slice(0, -1) : lower;
}
function pathMatches(path: string, prefix: string): boolean {
  const p = normPath(path);
  const pre = normPath(prefix);
  return p === pre || p.startsWith(`${pre}/`);
}

// Respinge path-uri ambigue inainte de authz (encoded slash / dot-segment / backslash).
// Verifica DOAR componenta de path, NU query-string-ul — altfel un
// `?numarDosar=4821%2F3%2F2024` (slash encodat legitim) ar da 403 si ar rupe cautarea.
function isSuspiciousPath(rawUrl: string): boolean {
  let p: string;
  try {
    p = new URL(rawUrl).pathname;
  } catch {
    // rawUrl deja relativ (unele harness-uri de test) → despica query-ul inainte de check.
    p = rawUrl.split("?")[0];
  }
  const lower = p.toLowerCase();
  return lower.includes("%2f") || lower.includes("%2e") || lower.includes("%5c") || p.includes("..");
}

export async function patCapabilityGate(c: Context, next: Next): Promise<Response | undefined> {
  const tokenId = c.get("tokenId");
  if (!tokenId) {
    // JWT complet / desktop → neafectat.
    await next();
    return;
  }
  const scopes = c.get("tokenScopes") ?? [];
  const method = c.req.method.toUpperCase();
  const path = c.req.path; // Hono path normalizat

  if (isSuspiciousPath(c.req.url)) {
    return c.json(fail(ErrorCodes.PAT_ROUTE_FORBIDDEN, "Cerere refuzata: path ambiguu.", c), 403);
  }

  // Rutele de management tokenuri sunt session-only. Gate-ul (montat pe /api/*) le prinde
  // inaintea router-ului, deci emite AICI codul corect (pat_cannot_manage_tokens). `pathMatches`
  // (granita de segment), NU `startsWith` brut — fara fals-pozitiv pe un viitor /api/v1/tokens-public.
  if (pathMatches(path, "/api/v1/tokens")) {
    return c.json(fail(ErrorCodes.PAT_CANNOT_MANAGE_TOKENS, "Un token nu poate administra tokenuri.", c), 403);
  }

  const cap = PAT_CAPABILITIES.find(
    (x) => x.method === method && (x.exact ? normPath(path) === normPath(x.prefix) : pathMatches(path, x.prefix))
  );
  if (!cap) {
    return c.json(fail(ErrorCodes.PAT_ROUTE_FORBIDDEN, "Tokenul nu are acces la aceasta ruta.", c), 403);
  }
  if (!scopes.includes(cap.scope)) {
    return c.json(fail(ErrorCodes.INSUFFICIENT_SCOPE, `Tokenul nu are scope-ul ${cap.scope}.`, c), 403);
  }
  await next();
  return;
}

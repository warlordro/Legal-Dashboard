import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import { stat } from "node:fs/promises";
import { z } from "zod";
import {
  executeSearch,
  executeBulkSearch,
  executeSplitSearch,
  type BulkSearchItem,
  type BulkProgress,
  type SplitSearchProgress,
} from "../services/rnpmSearchService.ts";
import { defaultRnpmClient, RnpmError, type RnpmSearchType } from "../services/rnpmClient.ts";
import { validateSubTypeLabels } from "../services/rnpmSubTypes.ts";
import { CaptchaInsufficientFundsError, getCaptchaBalance, type CaptchaProvider } from "../services/captchaSolver.ts";
import {
  BackupValidationError,
  compactRnpmDbViaWorker,
  createRnpmManualBackup,
  deleteAllRnpmAndCompact,
  deleteRnpmBackups,
  getRnpmBackupDir,
  listRnpmBackups,
  restoreRnpmFromBackup,
  withMaintenanceRead,
} from "../db/backup.ts";
import { recordAudit, recordAuditSafe } from "../db/auditRepository.ts";
import { hasActiveRnpmSearch, isRnpmRestoreInProgress, RnpmSearchActiveError } from "../db/rnpmActivity.ts";
import { assertValidOwnerId, getRnpmDbPath } from "../db/rnpmDb.ts";
import { mkdir } from "node:fs/promises";
import { getOwnerId } from "../middleware/owner.ts";
import { requireRole } from "../middleware/requireRole.ts";
import { requireDesktopHeader } from "../middleware/requireDesktopHeader.ts";
import { getAuthMode } from "../auth/config.ts";
import { getUserById } from "../db/userRepository.ts";
import { isTypedMaintenanceError, rethrowTypedMaintenanceError } from "../util/appErrorHandler.ts";
import { ErrorCodes, fail } from "../util/envelope.ts";
import { parseJsonBody, resolveCaptchaKeyForRoute, withRnpmCaptchaGuards } from "./rnpmGuards.ts";

function parseProvider(v: unknown): CaptchaProvider | undefined {
  return v === "capsolver" || v === "2captcha" ? v : undefined;
}

// Body size limits — prevent DoS via oversized POST payloads
const SEARCH_BODY_LIMIT = 64 * 1024; // 64KB: single search params
const BULK_BODY_LIMIT = 512 * 1024; // 512KB: up to 200 bulk items
const EXPORT_BODY_LIMIT = 256 * 1024; // 256KB: up to 5000 numeric ids
const SMALL_BODY_LIMIT = 4 * 1024; // 4KB: captcha balance

// v2.34.0 P1-3: server-side clamp pe pageSize / limit. Fara cap, un client
// (sau atacator) putea cere pageSize=100000 -> SQLite reader timeout + Node
// OOM. Cap 200 e suficient pentru UI normal (lista cu 200 randuri) si
// previne expunerea de unbounded data dumps.
const MAX_PAGE_SIZE = 200;

function clampPageSize(raw: number, fallback: number): number {
  const n = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
  return Math.min(Math.max(1, n), MAX_PAGE_SIZE);
}

const bodyTooLarge = (c: import("hono").Context) =>
  c.json(fail(ErrorCodes.PAYLOAD_TOO_LARGE, "Payload prea mare", c), 413);
const limitSearch = bodyLimit({ maxSize: SEARCH_BODY_LIMIT, onError: bodyTooLarge });
const limitBulk = bodyLimit({ maxSize: BULK_BODY_LIMIT, onError: bodyTooLarge });
const limitExport = bodyLimit({ maxSize: EXPORT_BODY_LIMIT, onError: bodyTooLarge });
const limitSmall = bodyLimit({ maxSize: SMALL_BODY_LIMIT, onError: bodyTooLarge });

const invalidJson = (c: import("hono").Context) => c.json(fail(ErrorCodes.INVALID_JSON, "JSON invalid", c), 400);
const invalidParams = (c: import("hono").Context, message: string) =>
  c.json(fail(ErrorCodes.INVALID_PARAMS, message, c), 400);
const notFound = (c: import("hono").Context, message: string) => c.json(fail(ErrorCodes.NOT_FOUND, message, c), 404);
const internalError = (c: import("hono").Context, message: string) =>
  c.json(fail(ErrorCodes.INTERNAL_ERROR, message, c), 500);
const duplicateRequest = (c: import("hono").Context, message: string) =>
  c.json(fail(ErrorCodes.DUPLICATE_REQUEST, message, c), 409);
const desktopOnly = (c: import("hono").Context) =>
  c.json(fail(ErrorCodes.DESKTOP_ONLY, "Functie disponibila doar in Electron", c), 501);

// W-1: defense in depth — cap string fields in params tree (500 chars per field, max depth 4)
const MAX_STRING_FIELD_LEN = 500;
function validateParamsDepth(obj: unknown, depth = 0): string | null {
  if (depth > 4) return "Parametri prea adanc imbricati";
  if (typeof obj === "string") {
    return obj.length > MAX_STRING_FIELD_LEN ? `Camp depaseste ${MAX_STRING_FIELD_LEN} caractere` : null;
  }
  if (obj && typeof obj === "object") {
    for (const v of Object.values(obj as Record<string, unknown>)) {
      const err = validateParamsDepth(v, depth + 1);
      if (err) return err;
    }
  }
  return null;
}

// v2.20.5: bump 60 min -> 90 min ca sa acopere worst-case-ul real al server cap-ului
// de 200 CUI in 1 stream singur. Estimare: 200 items × ~25s (worst-case ipoteci, mai
// mic pe specifice/fiducii) = ~83 min, plus margin pentru retries captcha si latenta
// upstream variabila. 60 min era sub estimare (taie stream-ul pe la item ~144) si
// auto-contradictoriu cu cap-ul ridicat in UI. 90 min ramane cap finit (taburile
// orfane nu hang-uiesc indefinit) dar acopera real flow-ul de "1 tab × 200 CUI".
const SSE_TIMEOUT_MS = 5400000;
// v2.18.0: bump 30 -> 45 min ca sa tolereze tier-2 split (destinatieInscriere).
// Worst case: ipoteci cu 18 sub-tipuri × 17s (tier-1) + 1-2 sub-tipuri care
// trigger nested cu 10 destinatii × 17s ≈ 18×17 + 2×10×17 = 646s. Plus latente
// captcha si retry, 45 min e suficient cu margin.
const SSE_SPLIT_TIMEOUT_MS = 2700000;
import {
  getAvize,
  getAvizById,
  deleteAviz,
  deleteAvizeByIds,
  filterRnpmSearchResults,
  getAvizeByIds,
  getAvizStats,
  RnpmSearchNotFoundError,
} from "../db/avizRepository.ts";
import { getSearches, deleteSearch } from "../db/searchRepository.ts";
import { buildRnpmPdf } from "../services/rnpmExportPdf.ts";
import { buildRnpmXlsx } from "../services/rnpmExportXlsx.ts";

const VALID_TYPES: readonly RnpmSearchType[] = ["ipoteci", "fiducii", "specifice", "creante", "obligatiuni"];

function isValidType(t: unknown): t is RnpmSearchType {
  return typeof t === "string" && (VALID_TYPES as readonly string[]).includes(t);
}

export const rnpmRouter = new Hono();

// CP-B8: opt-in idempotency. Clients may include `clientRequestId` (uuid) in the body;
// a second request with the same (ownerId, clientRequestId) while the first is still
// in-flight returns 409. Missing `clientRequestId` = legacy behavior (no dedup).
// Web-readiness closure (v2.11.0): inflight map cheia foloseste owner-ul real
// (`getOwnerId(c)` din `ownerContext`); pe desktop ramane "local" via fallback,
// in web mode izoleaza tenants. Acelasi ownerId este propagat la
// `executeSearch`/`executeBulkSearch` ca service-ul + repo-urile sa scrie sub
// owner-ul corect — singura schimbare de comportament pe desktop e zero
// (continua sa scrie sub "local").
//
// ANCHOR (web cutover): Map-ul este process-local. Pe desktop e suficient (un
// singur proces backend), dar in web mode cu mai multe instante backend acelasi
// (ownerId, dedupKey) ar putea sa ruleze de doua ori in paralel. Decizia
// distributed-store (Redis SETNX / Postgres advisory lock) este deferred la
// PR-11+ cutover-ul web — vezi PLAN-monitoring-webmode.md. Pana atunci, fara
// fallback distribuit aici.
const inflightRequests = new Map<string, Promise<unknown>>();
const inflightTimers = new Map<string, ReturnType<typeof setTimeout>>();
// Per-operation TTL ceiling: timeout-ul intern SSE + buffer 60s ca timer-ul
// sa nu reaper-uiasca o cerere care e inca activa pe upstream-ul lent. /search
// nu are timeout SSE intern, dar finally-ul curata oricum — TTL = safety net
// pentru cazul patologic in care finally-ul nu apuca sa ruleze (proces SIGKILL,
// finally-ul intra-n event loop iar GC kicks in, etc.).
// v2.37.1 (review cluster 4): 15 min — peste worst-case-ul real al unui
// /search (captcha solve 30-120s + retries + fetch-uri RNPM cu timeout 60s
// fiecare). TTL-ul vechi de 120s expira IN TIMPUL unei cautari normale:
// retry-ul clientului pornea o a doua cautare CONCURENTA cu originalul
// (captcha platit dublu, randuri saved-search duplicate).
export const INFLIGHT_TTL_SEARCH_MS = 900_000;
export const INFLIGHT_TTL_BULK_MS = SSE_TIMEOUT_MS + 60_000;
export const INFLIGHT_TTL_SPLIT_MS = SSE_SPLIT_TIMEOUT_MS + 60_000;

// Helperele NU schimba semantica existenta — sentinel-only invariant pe /bulk si /split
// se pastreaza pentru ca setInflight ramane sincron (zero await intre has() si set()).
// Timer-ul e doar un safety net: daca finally-ul nu apuca sa ruleze (proces SIGKILL
// mid-stream, GC al promise-urilor leak-uite), TTL elimina automat cheia.
export function setInflight(key: string, ttlMs: number, value: Promise<unknown>): void {
  const existing = inflightTimers.get(key);
  if (existing) clearTimeout(existing);
  inflightRequests.set(key, value);
  const timer = setTimeout(() => {
    inflightTimers.delete(key);
    inflightRequests.delete(key);
  }, ttlMs);
  timer.unref?.();
  inflightTimers.set(key, timer);
}

export function clearInflight(key: string): void {
  const timer = inflightTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    inflightTimers.delete(key);
  }
  inflightRequests.delete(key);
}

// Exportat doar pentru teste — ruteaza intern prin Map-ul de dedup, deci
// reflecta exact ce vede branch-ul `inflightRequests.has(dedupKey)` din rute.
export function hasInflight(key: string): boolean {
  return inflightRequests.has(key);
}

function inflightKey(ownerId: string, clientRequestId: string): string {
  return `${ownerId}:${clientRequestId}`;
}
function parseClientRequestId(body: Record<string, unknown> | null): string | null {
  const v = body?.clientRequestId;
  if (typeof v !== "string") return null;
  if (v.length === 0 || v.length > 128) return null;
  return v;
}

rnpmRouter.post("/search", limitSearch, async (c) => {
  const guard = await withRnpmCaptchaGuards(c);
  if (!guard.ok) return guard.response;
  const { body, captchaKey } = guard;
  // v2.43.0 (rnpm-split): gardul de restore loveste imediat dupa parsarea
  // body-ului si INAINTE de streamSSE — un throw dupa ce stream-ul a pornit
  // inseamna 200 deja trimis si eroare in mijlocul stream-ului. Sta DUPA
  // withRnpmCaptchaGuards (gate-urile web-mode nu au nevoie de ownerId) si
  // INAINTE de audit-ul de consum (nu logam consum pe o cerere refuzata).
  if (isRnpmRestoreInProgress(getOwnerId(c))) {
    return c.json(
      fail("RESTORE_IN_PROGRESS", "Restaurare in curs pentru acest cont; reincearca dupa finalizare", c),
      409
    );
  }
  if (guard.source === "tenant") {
    recordAudit(c, "rnpm.captcha.consume", {
      targetKind: "rnpm_search",
      detail: { provider: guard.captchaProvider ?? null, mode: guard.captchaMode ?? null, route: "search" },
    });
  }
  const { type, params, captchaProvider, fallback2CaptchaKey, captchaMode, startRnpmPage, batchSize, gcode, searchId } =
    (body ?? {}) as {
      type?: unknown;
      params?: unknown;
      captchaProvider?: unknown;
      fallback2CaptchaKey?: unknown;
      captchaMode?: unknown;
      startRnpmPage?: unknown;
      batchSize?: unknown;
      gcode?: unknown;
      searchId?: unknown;
    };

  if (!isValidType(type)) return invalidParams(c, "Tip cautare invalid");
  if (!params || typeof params !== "object") return invalidParams(c, "Parametri cautare lipsa");
  const paramsErr = validateParamsDepth(params);
  if (paramsErr) return invalidParams(c, paramsErr);
  const provider = guard.captchaProvider ?? parseProvider(captchaProvider);
  const startPage = typeof startRnpmPage === "number" && startRnpmPage >= 1 && startRnpmPage <= 500 ? startRnpmPage : 1;
  const batch = typeof batchSize === "number" && batchSize >= 1 && batchSize <= 200 ? batchSize : 25;
  const existingGcode = typeof gcode === "string" && gcode.length > 0 ? gcode : undefined;
  const existingSearchId = typeof searchId === "number" && Number.isFinite(searchId) ? searchId : undefined;

  const ownerId = getOwnerId(c);
  const clientRequestId = parseClientRequestId(body as Record<string, unknown> | null);
  const dedupKey = clientRequestId ? inflightKey(ownerId, clientRequestId) : null;
  if (dedupKey && inflightRequests.has(dedupKey)) {
    return duplicateRequest(c, "Cerere deja in curs (dedup clientRequestId)");
  }

  // v2.20.3 Grupul K — capture searchId imediat dupa ce e creat ca abort-ul
  // client mid-search sa-l poata include in 499 body (frontend foloseste asta
  // pentru a afisa partial state din /saved).
  let createdSearchId: number | null = existingSearchId ?? null;

  const run = executeSearch({
    type,
    params: params as Parameters<typeof executeSearch>[0]["params"],
    captchaKey,
    captchaProvider: provider,
    fallback2CaptchaKey:
      guard.fallback2CaptchaKey ?? (typeof fallback2CaptchaKey === "string" ? fallback2CaptchaKey : undefined),
    captchaMode: guard.captchaMode ?? (captchaMode === "race" ? "race" : "sequential"),
    ownerId,
    startRnpmPage: startPage,
    batchSize: batch,
    existingGcode,
    existingSearchId,
    signal: c.req.raw.signal,
    onSearchCreated: (sid) => {
      createdSearchId = sid;
    },
  });
  if (dedupKey) setInflight(dedupKey, INFLIGHT_TTL_SEARCH_MS, run);

  try {
    const result = await run;
    return c.json({
      searchId: result.searchId,
      total: result.total,
      pagesTotal: result.pagesTotal,
      pageSize: result.pageSize,
      currentPage: result.currentPage,
      criteriu: result.criteriu,
      documents: result.documents,
      avizIds: result.avizIds,
      detailsFailed: result.detailsFailed,
      gcode: result.gcode,
      nextRnpmPage: result.nextRnpmPage,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      console.log("[rnpm/search] aborted by client");
      // 499 = Client Closed Request (non-standard but widely used by nginx/others).
      // Hono's typed status codes exclude it, so emit via a plain Response.
      // v2.20.3 Grupul K: include searchId daca a fost creat (null daca abort
      // s-a intamplat inainte de saveSearch).
      return new Response(JSON.stringify({ error: "Cautare oprita", searchId: createdSearchId }), {
        status: 499,
        headers: { "Content-Type": "application/json" },
      });
    }
    // Structured "limit exceeded" — frontend foloseste `code` + `splittable` ca sa
    // ofere split via tipInscriere. Restul erorilor RNPM/JSON ramane 500 generic.
    if (e instanceof RnpmError && e.code === "limit_exceeded") {
      const total = typeof e.details?.total === "number" ? e.details.total : undefined;
      const limit = typeof e.details?.limit === "number" ? e.details.limit : undefined;
      return c.json(
        fail(ErrorCodes.LIMIT_EXCEEDED, e.message, c, {
          total,
          limit,
          splittable: { type },
        }),
        400
      );
    }
    const msg = e instanceof Error ? e.message : "Eroare necunoscuta";
    console.error("[rnpm/search]", msg);
    return internalError(c, msg);
  } finally {
    if (dedupKey) clearInflight(dedupKey);
  }
});

// ============================================================================
// POST /search/:searchId/filter - v2.24.0 filtru text peste rezultate cautare RNPM.
// Spec: docs/superpowers/specs/2026-05-13-rnpm-results-text-filter-design.md
// ============================================================================

const FILTER_CONTROL_CHARS_CLASS = "\\u0000-\\u001F\\u007F\\u200B-\\u200F\\uFEFF";
const FILTER_CONTROL_CHARS_RE = new RegExp(`[${FILTER_CONTROL_CHARS_CLASS}]`, "g");

const FilterBodySchema = z.object({
  q: z
    .string()
    .max(200, "Termen prea lung (max 200 caractere)")
    .transform((s) => s.trim())
    .refine((s) => s.length >= 2, "Minim 2 caractere dupa trim")
    .transform((s) => s.replace(FILTER_CONTROL_CHARS_RE, "")),
});

const SearchIdSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);

function logFilterEvent(entry: Record<string, unknown>): void {
  console.log(JSON.stringify({ ...entry, ts: new Date().toISOString() }));
}

rnpmRouter.post("/search/:searchId/filter", limitSearch, async (c) => {
  if (process.env.RNPM_RESULTS_FILTER_DISABLED === "1") {
    return c.json(fail(ErrorCodes.FILTER_DISABLED, "Filtrul de rezultate RNPM este dezactivat temporar.", c), 503);
  }

  const sidParsed = SearchIdSchema.safeParse(c.req.param("searchId"));
  if (!sidParsed.success) {
    return invalidParams(c, "searchId invalid");
  }
  const searchId = sidParsed.data;

  const body = await parseJsonBody(c);
  if (body === null) return invalidJson(c);
  const parsed = FilterBodySchema.safeParse(body);
  if (!parsed.success) {
    return invalidParams(c, parsed.error.issues[0]?.message ?? "Body invalid");
  }
  const { q } = parsed.data;

  const ownerId = getOwnerId(c);
  const t0 = Date.now();

  const timeoutSignal = AbortSignal.timeout(5000);
  const signal = AbortSignal.any([c.req.raw.signal, timeoutSignal]);

  try {
    const result = await withMaintenanceRead(async () => filterRnpmSearchResults({ ownerId, searchId, q, signal }));

    logFilterEvent({
      action: "rnpm.results.filter",
      ownerId,
      searchId,
      qLen: q.length,
      matchedCount: result.matchedCount,
      truncated: result.truncated,
      missingDetails: result.missingDetails,
      latencyMs: Date.now() - t0,
      status: "ok",
    });

    return c.json(result, 200);
  } catch (err) {
    const latencyMs = Date.now() - t0;
    if (err instanceof RnpmSearchNotFoundError) {
      logFilterEvent({
        action: "rnpm.results.filter",
        ownerId,
        searchId,
        qLen: q.length,
        latencyMs,
        status: "not_found",
      });
      return notFound(c, "Search inexistent");
    }
    if (err instanceof Error && err.name === "AbortError") {
      if (timeoutSignal.aborted) {
        logFilterEvent({
          action: "rnpm.results.filter",
          ownerId,
          searchId,
          qLen: q.length,
          latencyMs,
          status: "timeout",
        });
        return c.json(fail(ErrorCodes.FILTER_TIMEOUT, "Timeout filtrare", c), 503);
      }
      logFilterEvent({
        action: "rnpm.results.filter",
        ownerId,
        searchId,
        qLen: q.length,
        latencyMs,
        status: "abort",
      });
      return new Response(null, { status: 499 });
    }
    logFilterEvent({
      action: "rnpm.results.filter",
      ownerId,
      searchId,
      qLen: q.length,
      latencyMs,
      status: "error",
    });
    console.error("[rnpm.filter] eroare neasteptata", err);
    return internalError(c, "Eroare interna filtrare");
  }
});

rnpmRouter.post("/bulk", limitBulk, async (c) => {
  const guard = await withRnpmCaptchaGuards(c);
  if (!guard.ok) return guard.response;
  const { body, captchaKey } = guard;
  // v2.43.0 (rnpm-split): gard pre-SSE, vezi nota de la POST /search.
  if (isRnpmRestoreInProgress(getOwnerId(c))) {
    return c.json(
      fail("RESTORE_IN_PROGRESS", "Restaurare in curs pentru acest cont; reincearca dupa finalizare", c),
      409
    );
  }
  if (guard.source === "tenant") {
    recordAudit(c, "rnpm.captcha.consume", {
      targetKind: "rnpm_search",
      detail: { provider: guard.captchaProvider ?? null, mode: guard.captchaMode ?? null, route: "bulk" },
    });
  }
  const { items, captchaProvider, fallback2CaptchaKey, captchaMode } = body as {
    items?: unknown;
    captchaProvider?: unknown;
    fallback2CaptchaKey?: unknown;
    captchaMode?: unknown;
  };

  if (!Array.isArray(items) || items.length === 0) return invalidParams(c, "Lista cautari goala");
  if (items.length > 200) return invalidParams(c, "Maxim 200 cautari per bulk");
  const provider = guard.captchaProvider ?? parseProvider(captchaProvider);

  const ownerId = getOwnerId(c);
  const clientRequestId = parseClientRequestId(body as Record<string, unknown> | null);
  const dedupKey = clientRequestId ? inflightKey(ownerId, clientRequestId) : null;

  const validItems: BulkSearchItem[] = [];
  for (const it of items) {
    const item = it as { type?: unknown; params?: unknown; label?: unknown };
    if (!isValidType(item.type)) return invalidParams(c, "Tip cautare invalid in lista");
    if (!item.params || typeof item.params !== "object") return invalidParams(c, "Parametri invalidi");
    const paramsErr = validateParamsDepth(item.params);
    if (paramsErr) return invalidParams(c, paramsErr);
    validItems.push({
      type: item.type,
      params: item.params as BulkSearchItem["params"],
      label: typeof item.label === "string" ? item.label : undefined,
    });
  }

  // CP-B8 (v2.20.3): rezervare sincrona DUPA validare, INAINTE de streamSSE.
  // Hono streamSSE invoca cb-ul sincron (cb-ul ruleaza pana la primul await
  // inainte ca streamSSE sa returneze), deci varianta veche cu set() in
  // interiorul cb-ului era de facto race-free. Forma actuala face contractul
  // explicit: orice refactor care strecoara un await intre has() si set()
  // (sau care schimba semantica streamSSE) nu mai poate sparge dedup-ul.
  // Bonus: evita leak-ul potential pe early-return din loop-ul de validare
  // si decupleaza dedup-ul de fluxul SSE. Sentinel `Promise.resolve()` —
  // Map-ul e folosit doar pentru has(), valoarea e indiferenta.
  if (dedupKey) {
    if (inflightRequests.has(dedupKey)) {
      return duplicateRequest(c, "Bulk deja in curs (dedup clientRequestId)");
    }
    setInflight(dedupKey, INFLIGHT_TTL_BULK_MS, Promise.resolve());
  }

  return streamSSE(c, async (stream) => {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    c.req.raw.signal?.addEventListener?.("abort", onAbort);

    // SSE hard timeout — guarantee the stream never hangs indefinitely
    const timeoutHandle = setTimeout(() => controller.abort(), SSE_TIMEOUT_MS);

    const send = (p: BulkProgress) =>
      stream
        .writeSSE({
          event: "progress",
          data: JSON.stringify(p),
        })
        .catch((err) => {
          // F06 (audit 2026-07-09): call site-urile `void send(p)` nu au await —
          // un reject aici (client deconectat mid-stream) ar deveni
          // unhandledRejection => process.exit(1) in server mode (index.ts) si
          // ar dobori TOT procesul web. Log si continua; fluxul se opreste
          // oricum prin abort/timeout.
          console.error("[rnpm] bulk progress writeSSE failed (client disconnected?)", err);
        });

    const bulkRun = executeBulkSearch(
      validItems,
      captchaKey,
      ownerId,
      (p) => {
        void send(p);
      },
      defaultRnpmClient,
      controller.signal,
      provider,
      guard.fallback2CaptchaKey ?? (typeof fallback2CaptchaKey === "string" ? fallback2CaptchaKey : undefined),
      guard.captchaMode ?? (captchaMode === "race" ? "race" : "sequential")
    );

    try {
      await bulkRun;
      await stream.writeSSE({ event: "complete", data: "{}" });
    } catch (e) {
      // v2.20.3 Grupul K + L — diferentiere abort/timeout vs error generic.
      // Bulk emite searchId per-item via progress events, deci nu mai e nevoie
      // sa-l surface din nou aici.
      if (e instanceof DOMException && e.name === "AbortError") {
        const clientAborted = c.req.raw.signal?.aborted === true;
        const eventName = clientAborted ? "aborted" : "timeout";
        await stream.writeSSE({
          event: eventName,
          data: JSON.stringify({
            reason: clientAborted ? "client_aborted" : "server_timeout",
            timeoutMs: clientAborted ? undefined : SSE_TIMEOUT_MS,
          }),
        });
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        await stream.writeSSE({ event: "error", data: JSON.stringify({ error: msg }) });
      }
    } finally {
      clearTimeout(timeoutHandle);
      c.req.raw.signal?.removeEventListener?.("abort", onAbort);
      if (dedupKey) clearInflight(dedupKey);
    }
  });
});

// Split search via tipInscriere — fallback la cautari care depasesc cap-ul RNPM
// de 1500 rezultate. Frontend trimite `subTypeLabels` (ordonate, indexate 1-based)
// dupa confirmare; backend ruleaza N executeSearch independente, fiecare cu
// {tipInscriere: {type: "1", value: "<i+1>"}} si emite progress per sub-tip.
// Sub-tipurile care singure depasesc cap-ul sunt marcate "blocked" cu gapReason
// (terminal_cap / silent_refusal / residual_unclassified) si skipped; celelalte
// continua. Vezi rnpmSearchService.executeSplitSearch.
rnpmRouter.post("/search-split", limitSearch, async (c) => {
  const guard = await withRnpmCaptchaGuards(c);
  if (!guard.ok) return guard.response;
  const { body, captchaKey } = guard;
  // v2.43.0 (rnpm-split): gard pre-SSE, vezi nota de la POST /search.
  if (isRnpmRestoreInProgress(getOwnerId(c))) {
    return c.json(
      fail("RESTORE_IN_PROGRESS", "Restaurare in curs pentru acest cont; reincearca dupa finalizare", c),
      409
    );
  }
  if (guard.source === "tenant") {
    recordAudit(c, "rnpm.captcha.consume", {
      targetKind: "rnpm_search",
      detail: { provider: guard.captchaProvider ?? null, mode: guard.captchaMode ?? null, route: "search-split" },
    });
  }
  const { type, baseParams, subTypeLabels, captchaProvider, fallback2CaptchaKey, captchaMode } = body as {
    type?: unknown;
    baseParams?: unknown;
    subTypeLabels?: unknown;
    captchaProvider?: unknown;
    fallback2CaptchaKey?: unknown;
    captchaMode?: unknown;
  };

  if (!isValidType(type)) return invalidParams(c, "Tip cautare invalid");
  if (!baseParams || typeof baseParams !== "object") return invalidParams(c, "Parametri cautare lipsa");
  const paramsErr = validateParamsDepth(baseParams);
  if (paramsErr) return invalidParams(c, paramsErr);
  if (!Array.isArray(subTypeLabels) || subTypeLabels.length === 0) {
    return invalidParams(c, "Lista sub-tipuri goala");
  }
  if (subTypeLabels.length > 50) {
    return invalidParams(c, "Maxim 50 sub-tipuri per split");
  }
  for (const label of subTypeLabels) {
    if (typeof label !== "string" || label.length === 0 || label.length > 200) {
      return invalidParams(c, "Sub-tip invalid in lista");
    }
  }
  // v2.20.3 Grupul O — allow-list canonica per categorie (mirror backend al
  // frontend/src/components/rnpm/rnpm-form-constants.ts). Pana acum backend
  // accepta orice string array, ceea ce permitea drift sau tampering pe
  // indexarea 1-based pe care RNPM o asteapta in `tipInscriere.value`.
  const canonicalErr = validateSubTypeLabels(type, subTypeLabels as string[]);
  if (canonicalErr) {
    return invalidParams(c, canonicalErr);
  }
  const provider = guard.captchaProvider ?? parseProvider(captchaProvider);

  const ownerId = getOwnerId(c);
  const clientRequestId = parseClientRequestId(body as Record<string, unknown> | null);
  const dedupKey = clientRequestId ? inflightKey(ownerId, clientRequestId) : null;
  // CP-B8 (v2.20.3): vezi nota pe ruta /bulk — aceeasi rezervare sincrona
  // inainte de streamSSE, ca contract explicit. Valoarea Map-ului e sentinel.
  if (dedupKey) {
    if (inflightRequests.has(dedupKey)) {
      return duplicateRequest(c, "Split deja in curs (dedup clientRequestId)");
    }
    setInflight(dedupKey, INFLIGHT_TTL_SPLIT_MS, Promise.resolve());
  }

  return streamSSE(c, async (stream) => {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    c.req.raw.signal?.addEventListener?.("abort", onAbort);
    const timeoutHandle = setTimeout(() => controller.abort(), SSE_SPLIT_TIMEOUT_MS);

    const send = (p: SplitSearchProgress) =>
      stream
        .writeSSE({
          event: "progress",
          data: JSON.stringify(p),
        })
        .catch((err) => {
          // F06 (audit 2026-07-09): vezi comentariul din bulk — anti proces-kill.
          console.error("[rnpm] split progress writeSSE failed (client disconnected?)", err);
        });

    // v2.20.3 Grupul K — capture parentSearchId imediat ce e creat, ca abort-ul
    // sau timeout-ul mid-search sa poata emite SSE `aborted`/`timeout` cu
    // searchId. Fara asta, frontend pierdea referinta si nu putea afisa
    // partial state din istoric.
    let parentSearchId: number | null = null;

    const splitRun = executeSplitSearch(
      {
        type,
        baseParams: baseParams as Parameters<typeof executeSplitSearch>[0]["baseParams"],
        subTypeLabels: subTypeLabels as string[],
        captchaKey,
        captchaProvider: provider,
        fallback2CaptchaKey:
          guard.fallback2CaptchaKey ?? (typeof fallback2CaptchaKey === "string" ? fallback2CaptchaKey : undefined),
        captchaMode: guard.captchaMode ?? (captchaMode === "race" ? "race" : "sequential"),
        ownerId,
        signal: controller.signal,
        onSearchCreated: (sid) => {
          parentSearchId = sid;
          // Emite "started" SSE imediat ca front-ul sa stie searchId-ul chiar
          // daca user-ul aborteaza inainte de prima sub-cautare.
          void stream
            .writeSSE({
              event: "started",
              data: JSON.stringify({ searchId: sid }),
            })
            .catch((err) => {
              // F06 (audit 2026-07-09): vezi comentariul din bulk — anti proces-kill.
              console.error("[rnpm] split started writeSSE failed (client disconnected?)", err);
            });
        },
      },
      (p) => {
        void send(p);
      },
      defaultRnpmClient
    );

    try {
      const result = await splitRun;
      // Audit observability: log gap-uri reziduale (rezultate care nu au putut fi
      // recuperate via tier-1+tier-2). Util pentru a urmari frecventa cazurilor
      // terminal_cap / silent_refusal / residual_unclassified pe productie.
      // v2.20.3 Grupul O — kill switch operational: daca audit_log creste prea
      // repede sau daca un incident ne forteaza dezactivarea temporara, set
      // RNPM_AUDIT_CAP_HIT_DISABLED=1 sare INSERT-ul rnpm.cap_hit fara restart.
      const auditCapHitDisabled = process.env.RNPM_AUDIT_CAP_HIT_DISABLED === "1";
      const blockedStats = result.splitStats.filter((s) => s.status === "blocked" || s.status === "partial");
      if (!auditCapHitDisabled && (blockedStats.length > 0 || result.upstreamTotal !== result.total)) {
        const gapByReason: Record<string, number> = {};
        // Tier-1 contributors: foloseste s.gap (deja calculat in service) cand exista,
        // altfel cade la max(0, subTotal - count). Evita dublu-numararea pentru
        // status === "partial" unde s.gap = subTotal - SUM(nested.subTotal).
        for (const s of blockedStats) {
          if (s.gapReason) {
            const missing = s.gap ?? Math.max(0, (s.subTotal ?? 0) - (s.count ?? 0));
            gapByReason[s.gapReason] = (gapByReason[s.gapReason] ?? 0) + missing;
          }
          // Tier-2 nested gaps (residual_unclassified pe tier-1 nu acopera asta —
          // fiecare destinatie blocata individual emite propriul gapReason).
          if (s.nested) {
            for (const n of s.nested) {
              if (n.gapReason) {
                const missing = Math.max(0, (n.subTotal ?? 0) - (n.count ?? 0));
                gapByReason[n.gapReason] = (gapByReason[n.gapReason] ?? 0) + missing;
              }
            }
          }
        }
        // blockedLabels include atat tier-1 cat si tier-2 (cu prefix "tier1 > tier2"
        // pentru destinatii). Cap la 20 ca sa nu poluam audit_log la search-uri patologice.
        const blockedLabels: Array<{
          label: string;
          status: string;
          gapReason?: string;
          subTotal?: number;
          count?: number;
        }> = [];
        for (const s of blockedStats) {
          blockedLabels.push({
            label: s.label,
            status: s.status,
            gapReason: s.gapReason,
            subTotal: s.subTotal,
            count: s.count,
          });
          if (s.nested) {
            for (const n of s.nested) {
              if (n.status === "blocked" || n.status === "error") {
                blockedLabels.push({
                  label: `${s.label} > ${n.label}`,
                  status: n.status,
                  gapReason: n.gapReason,
                  subTotal: n.subTotal,
                  count: n.count,
                });
              }
            }
          }
        }
        const cappedLabels = blockedLabels.slice(0, 20);
        // recordAudit propaga erori (cf. auditRepository.ts header). Un INSERT
        // esuat in audit_log NU trebuie sa flip-uiasca success-ul SSE in error,
        // asa ca izolam local — observability != hard dependency.
        try {
          recordAudit(c, "rnpm.cap_hit", {
            targetKind: "search",
            targetId: String(result.searchId),
            detail: {
              // searchType e enum low-cardinality (RnpmSearchType), nu PII.
              // criteriu (CUI/CNP/nume) NU se loga in detail — duplicat al
              // payload-ului de cautare; gdpr-friendly daca audit_log e exportat.
              searchType: type,
              upstreamTotal: result.upstreamTotal,
              recovered: result.total,
              gap: result.upstreamTotal - result.total,
              gapByReason,
              blockedLabels: cappedLabels,
              blockedLabelsTruncated: blockedLabels.length > cappedLabels.length,
            },
          });
        } catch (auditErr) {
          console.warn(
            `[rnpm.cap_hit] audit insert failed for searchId=${result.searchId}: ${
              auditErr instanceof Error ? auditErr.message : String(auditErr)
            }`
          );
        }
      }
      await stream.writeSSE({
        event: "complete",
        data: JSON.stringify(result),
      });
    } catch (e) {
      // v2.20.3 Grupul K + L — diferentiere abort/timeout vs error generic ca
      // frontend-ul sa stie ce sa afiseze (toast "anulat" vs "eroare"), si sa
      // includa searchId daca a fost creat (partial state recoverable din
      // istoric, vezi /saved). Timeout-ul intern (SSE_SPLIT_TIMEOUT_MS)
      // declanseaza tot AbortError pe controller, distinctia se face prin
      // c.req.raw.signal.aborted (true = client a inchis) vs false (timeout intern).
      if (e instanceof DOMException && e.name === "AbortError") {
        const clientAborted = c.req.raw.signal?.aborted === true;
        const eventName = clientAborted ? "aborted" : "timeout";
        await stream.writeSSE({
          event: eventName,
          data: JSON.stringify({
            searchId: parentSearchId,
            reason: clientAborted ? "client_aborted" : "server_timeout",
            timeoutMs: clientAborted ? undefined : SSE_SPLIT_TIMEOUT_MS,
          }),
        });
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({ error: msg, searchId: parentSearchId }),
        });
      }
    } finally {
      clearTimeout(timeoutHandle);
      c.req.raw.signal?.removeEventListener?.("abort", onAbort);
      if (dedupKey) clearInflight(dedupKey);
    }
  });
});

const SORT_KEYS = new Set(["id", "identificator", "search_type", "data", "tip", "activ"]);

rnpmRouter.get("/saved", (c) => {
  const pageRaw = Number(c.req.query("page") ?? 0);
  const pageSizeRaw = Number(c.req.query("pageSize") ?? 25);
  const searchType = c.req.query("searchType") ?? undefined;
  const activStr = c.req.query("activ");
  const activ = activStr == null ? undefined : activStr === "true";
  const searchText = c.req.query("q") ?? undefined;
  const sortKeyRaw = c.req.query("sortKey");
  const sortDirRaw = c.req.query("sortDir");

  const result = getAvize({
    ownerId: getOwnerId(c),
    page: Number.isFinite(pageRaw) && pageRaw >= 0 ? pageRaw : 0,
    pageSize: clampPageSize(pageSizeRaw, 25),
    searchType,
    activ,
    searchText,
    dataStart: c.req.query("dataStart") ?? undefined,
    dataStop: c.req.query("dataStop") ?? undefined,
    sortKey:
      sortKeyRaw && SORT_KEYS.has(sortKeyRaw)
        ? (sortKeyRaw as "id" | "identificator" | "search_type" | "data" | "tip" | "activ")
        : undefined,
    sortDir: sortDirRaw === "asc" || sortDirRaw === "desc" ? sortDirRaw : undefined,
  });
  return c.json(result);
});

rnpmRouter.get("/saved/:id", (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return invalidParams(c, "ID invalid");
  const aviz = getAvizById(id, getOwnerId(c));
  if (!aviz) return notFound(c, "Aviz inexistent");
  return c.json(aviz);
});

rnpmRouter.delete("/saved/all", requireDesktopHeader, requireRole("admin", "user"), async (c) => {
  const ownerId = getOwnerId(c);
  try {
    // EXT-M-01 (audit v2.43.0): gardul de cautare + delete + compact ATOMIC
    // in DB layer (un singur write lock + latch de owner) — o cautare noua nu
    // mai poate repopula baza intre delete si compact.
    const { deleted, compacted } = await deleteAllRnpmAndCompact(ownerId);
    // Mutatia e COMISA — un esec al scrierii de audit nu are voie sa intoarca
    // 500 (clientul ar repeta un delete deja terminat). Contract Rev. 4.
    recordAuditSafe(c, "aviz.delete_all", {
      targetKind: "aviz",
      detail: { deleted, compacted },
    });
    return c.json({ deleted, compacted });
  } catch (e) {
    // B1/P2: acopera si MAINTENANCE_SHUTDOWN (nu doar cele doua cunoscute) si
    // un esec de audit nu are voie sa transforme 409/503 in 500.
    if (isTypedMaintenanceError(e)) {
      const code = (e as { code?: string }).code ?? "unknown";
      recordAuditSafe(c, "aviz.delete_all", {
        outcome: "denied",
        targetKind: "aviz",
        detail: { reason: code.toLowerCase() },
      });
    }
    // SEARCH_ACTIVE / RESTORE_IN_PROGRESS / MAINTENANCE_SHUTDOWN => 409/503
    // prin handlerul central (appErrorHandler).
    rethrowTypedMaintenanceError(e);
    console.error("[rnpm] delete-all failed:", e);
    return internalError(c, "Eroare interna la stergere. Reincearca sau contacteaza administratorul.");
  }
});

rnpmRouter.post("/saved/delete-batch", requireDesktopHeader, limitExport, async (c) => {
  const ownerId = getOwnerId(c);
  const body = await parseJsonBody(c);
  if (body === null) return invalidJson(c);
  const { ids } = (body ?? {}) as { ids?: unknown };
  if (!Array.isArray(ids) || ids.length === 0) return invalidParams(c, "Lista id-uri goala");
  const numIds = ids.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (numIds.length === 0) return invalidParams(c, "Lista id-uri invalida");
  if (numIds.length > 500) return invalidParams(c, "Maxim 500 avize per batch");
  // v2.43.0 (rnpm-split): acelasi gard ca la /saved/all — MUTAT dupa
  // validarile de body (P3, fix TOCTOU) ca o cautare pornita in timpul
  // parse-ului sa nu mai poata scapa neverificata.
  if (hasActiveRnpmSearch(ownerId)) {
    recordAuditSafe(c, "aviz.delete_batch", {
      outcome: "denied",
      targetKind: "aviz",
      detail: { reason: "search_active" },
    });
    return c.json(
      fail(ErrorCodes.SEARCH_ACTIVE, "Exista o cautare RNPM in curs pentru acest cont; reincearca dupa finalizare", c),
      409
    );
  }
  const deleted = deleteAvizeByIds(numIds, ownerId);
  // Mutatia e COMISA — un esec al scrierii de audit nu are voie sa intoarca
  // 500 (clientul ar repeta un delete deja terminat). Contract Rev. 4.
  recordAuditSafe(c, "aviz.delete_batch", {
    targetKind: "aviz",
    detail: { requested: numIds.length, deleted },
  });
  return c.json({ deleted });
});

// Task 15 (INT-M10): async cu semantica ENOENT-only — DOAR ENOENT inseamna
// "fisierul nu exista"; EACCES/EIO/ENOTDIR se propaga, altfel un fisier real
// dar inaccesibil ar raporta fals "baza nu exista inca" catre caller.
async function rnpmFileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return false;
    throw e;
  }
}

rnpmRouter.get("/stats", requireRole("admin", "user"), async (c) => {
  // v2.43.0 (rnpm-split): statisticile si dimensiunea raporteaza FISIERUL
  // PER USER al callerului, nu monolitul.
  const ownerId = getOwnerId(c);
  const dbPath = getRnpmDbPath(ownerId);
  // Fix review (Task 6): existence-check LA NIVEL DE RUTA, inainte de orice
  // apel de repository — getAvizStats provisioneaza fisierul prin getRnpmDb,
  // iar un GET nu are voie sa creeze fisiere pe disc pentru un user care nu a
  // folosit inca RNPM. Latch-ul de restore ramane PRIORITAR: in timpul unui
  // restore raspunsul corect e 409 (prin getRnpmDb -> maparea centrala), nu
  // zerouri false pentru un fisier aflat mid-swap.
  if (!isRnpmRestoreInProgress(ownerId) && !(await rnpmFileExists(dbPath))) {
    return c.json({ total: 0, activ: 0, inactiv: 0, byType: {}, db: { sizeBytes: 0 } });
  }
  const stats = getAvizStats(ownerId);
  // CP-B4: async fs so handler does not block the event loop under concurrency (web mode).
  const sizeOf = async (p: string): Promise<number> => {
    try {
      return (await stat(p)).size;
    } catch (e) {
      // DOAR ENOENT inseamna fisier absent (sidecar -wal/-shm poate lipsi normal);
      // EACCES/EIO se propaga — altfel raportam dimensiuni false.
      if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return 0;
      throw e;
    }
  };
  const [main, wal, shm] = await Promise.all([sizeOf(dbPath), sizeOf(`${dbPath}-wal`), sizeOf(`${dbPath}-shm`)]);
  return c.json({ ...stats, db: { sizeBytes: main + wal + shm } });
});

// Desktop-only: reveal the DB file in the system file manager via Electron shell.
// `require("electron")` is marked external at bundle time (scripts/build.js) so it
// resolves at runtime inside the main process; web deployments will hit the catch
// and return 501.
rnpmRouter.post("/open-db-folder", requireDesktopHeader, requireRole("admin", "user"), (c) => {
  // v2.43.0 (rnpm-split): dezvaluie FISIERUL RNPM al userului local.
  const dbPath = getRnpmDbPath(getOwnerId(c));
  try {
    // esbuild emits `require("electron")` verbatim in the CJS bundle because
    // electron is marked external (scripts/build.js). At runtime inside Electron's
    // main process the CJS loader resolves it; outside Electron it throws.
    const electron = require("electron") as { shell?: { showItemInFolder?: (p: string) => void } };
    if (!electron?.shell?.showItemInFolder) {
      return desktopOnly(c);
    }
    electron.shell.showItemInFolder(dbPath);
    return c.json({ ok: true });
  } catch (e) {
    console.error("[rnpm] open-db-folder failed:", e);
    return internalError(c, "Eroare interna. Reincearca sau contacteaza administratorul cu requestId-ul din raspuns.");
  }
});

rnpmRouter.post("/compact", requireDesktopHeader, requireRole("admin", "user"), async (c) => {
  // v2.43.0 (rnpm-split): compacteaza FISIERUL PER USER al callerului.
  // Task 7: prin worker + swap sub maintenance lock (VACUUM-ul nu mai
  // blocheaza event loop-ul si nu mai ruleaza pe handle-ul viu).
  // v2.43.x (admin rnpm storage): adminul poate tinti alt owner prin
  // ?ownerId= — acelasi mecanism ca la backups (resolveBackupOwner: non-admin
  // e ignorat silentios, ownerId invalid de la admin = 400).
  let ownerId: string;
  try {
    ownerId = resolveBackupOwner(c, c.req.query("ownerId"));
  } catch (e) {
    return invalidParams(c, e instanceof Error ? e.message : "ownerId invalid");
  }
  const caller = getOwnerId(c);
  const targetDetail = ownerId === caller ? undefined : ownerId;
  // Fix review (Task 6): fara fisier nu exista nimic de compactat — 404, nu
  // provisioning implicit prin getRnpmDb. Latch-ul de restore ramane
  // prioritar (409 prin rethrow, nu 404 pentru un fisier mid-swap).
  if (!isRnpmRestoreInProgress(ownerId)) {
    let dbExists: boolean;
    try {
      dbExists = await rnpmFileExists(getRnpmDbPath(ownerId));
    } catch (e) {
      // Fix review Codex: EACCES/EIO la proba de existenta (semantica
      // ENOENT-only) mergea direct in handlerul central FARA urma in audit —
      // tentativa si ownerul afectat trebuie inregistrate inainte de 500.
      recordAuditSafe(c, "rnpm.compact", {
        targetKind: "rnpm_db",
        ownerId,
        outcome: "error",
        detail: { error: e instanceof Error ? e.message : String(e), targetOwnerId: targetDetail },
      });
      throw e;
    }
    if (!dbExists) {
      // Tentativa admin pe owner fara fisier trebuie sa lase urma in audit.
      recordAuditSafe(c, "rnpm.compact", {
        targetKind: "rnpm_db",
        ownerId,
        outcome: "denied",
        detail: { error: "rnpm_db_not_found", targetOwnerId: targetDetail },
      });
      return notFound(c, "Baza RNPM nu exista inca pentru acest cont");
    }
  }
  try {
    const result = await compactRnpmDbViaWorker(ownerId);
    recordAuditSafe(c, "rnpm.compact", {
      targetKind: "rnpm_db",
      ownerId,
      detail: { beforeBytes: result.beforeBytes, afterBytes: result.afterBytes, targetOwnerId: targetDetail },
    });
    return c.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Eroare compactare baza";
    recordAuditSafe(c, "rnpm.compact", {
      targetKind: "rnpm_db",
      ownerId,
      outcome: isTypedMaintenanceError(e) ? "denied" : "error",
      detail: { error: msg, targetOwnerId: targetDetail },
    });
    // Fix review (Task 5): erorile tipate (restore in curs, cautare activa,
    // shutdown) ies spre handlerul central => 409/503, nu 500 generic.
    rethrowTypedMaintenanceError(e);
    // Mesajul brut poate contine path-uri/worker internals; raw-ul ramane in
    // console.error + detail.error din audit, clientul primeste mesaj generic.
    console.error("[rnpm] compact failed:", e);
    return internalError(c, "Eroare interna la compactare. Reincearca sau contacteaza administratorul.");
  }
});

// v2.43.0 (rnpm-split): backup self-service OWNER-SCOPED — fiecare user
// opereaza pe jail-ul lui (backups/rnpm/<stem>/). Adminul poate tinti alt
// owner prin ?ownerId= (GET/DELETE) sau body.ownerId (restore); pentru
// non-admini cererea straina se IGNORA silentios (primesc jail-ul propriu,
// fara oracle de existenta). Rutele monolitului s-au mutat in /api/v1/admin/backups.
function resolveBackupOwner(c: import("hono").Context, requested: string | undefined): string {
  const caller = getOwnerId(c);
  if (!requested || requested === caller) return caller;
  if (c.get("role") !== "admin") return caller; // non-admin: cererea straina se ignora silentios
  try {
    assertValidOwnerId(requested); // fail-closed inainte de orice folosire in path
  } catch (e) {
    // Fix review (Task 2): ownerId invalid de la admin e INPUT invalid (400),
    // nu eroare interna — eroarea tipata lasa rutele sa clasifice corect.
    throw new BackupValidationError(e instanceof Error ? e.message : "ownerId invalid");
  }
  return requested;
}

// Cooldown 60s per owner pe backup-ul manual: create = maintenance lock +
// VACUUM INTO + offsite hook, abuzabil prin click-loop. Pattern-ul de la
// /email-settings/test (429 + Retry-After). Cooldown-ul se seteaza LA START
// (anti-double-submit) si se REFUNDEAZA la esec — un create picat nu
// blocheaza retry-ul userului 60s (fix review, Task 2).
// Decizie documentata (Task 2.3): restore-ul NU primeste cooldown separat —
// prune-ul de la finalul restore-ului plafoneaza cresterea discului
// (pre-restore cap 5), iar rate-limit-urile globale raman singura frana.
const BACKUP_CREATE_COOLDOWN_MS = 60_000;
const lastBackupCreateByOwner = new Map<string, number>();
function pruneExpiredBackupCooldowns(now: number): void {
  for (const [owner, ts] of lastBackupCreateByOwner) {
    if (now - ts > BACKUP_CREATE_COOLDOWN_MS) lastBackupCreateByOwner.delete(owner);
  }
}
export function __resetRnpmBackupCooldownForTests(): void {
  lastBackupCreateByOwner.clear();
}

rnpmRouter.get("/backups", requireRole("admin", "user"), async (c) => {
  try {
    const owner = resolveBackupOwner(c, c.req.query("ownerId"));
    const backups = await listRnpmBackups(owner);
    return c.json({ backups });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Eroare listare backups";
    if (e instanceof BackupValidationError) return invalidParams(c, msg);
    console.error("[rnpm] backups list failed:", e);
    return internalError(c, "Eroare interna. Reincearca sau contacteaza administratorul cu requestId-ul din raspuns.");
  }
});

rnpmRouter.post("/backups/create", requireDesktopHeader, requireRole("admin", "user"), limitSmall, async (c) => {
  const ownerId = getOwnerId(c);
  pruneExpiredBackupCooldowns(Date.now());
  const now = Date.now();
  const elapsed = now - (lastBackupCreateByOwner.get(ownerId) ?? 0);
  if (elapsed < BACKUP_CREATE_COOLDOWN_MS) {
    const retryAfterSec = Math.ceil((BACKUP_CREATE_COOLDOWN_MS - elapsed) / 1000);
    recordAuditSafe(c, "backup.rnpm.create", {
      outcome: "denied",
      targetKind: "backup",
      detail: { reason: "cooldown", retryAfterSec },
    });
    c.header("Retry-After", String(retryAfterSec));
    return c.json(
      fail(ErrorCodes.COOLDOWN, `Asteapta ${retryAfterSec}s inainte sa creezi alt backup`, c, { retryAfterSec }),
      429
    );
  }
  lastBackupCreateByOwner.set(ownerId, now);
  try {
    const { name } = await createRnpmManualBackup(ownerId);
    recordAuditSafe(c, "backup.rnpm.create", {
      targetKind: "backup",
      targetId: name,
    });
    return c.json({ ok: true, name });
  } catch (e) {
    // Refund pe esec: cooldown-ul consumat la start isi pierde ratiunea
    // (nu exista backup de protejat); retry-ul imediat trebuie sa mearga.
    lastBackupCreateByOwner.delete(ownerId);
    const msg = e instanceof Error ? e.message : "Eroare creare backup";
    recordAuditSafe(c, "backup.rnpm.create", {
      targetKind: "backup",
      outcome: isTypedMaintenanceError(e) ? "denied" : "error",
      detail: { error: msg },
    });
    rethrowTypedMaintenanceError(e);
    console.error("[rnpm] backups create failed:", e);
    return internalError(c, "Eroare interna. Reincearca sau contacteaza administratorul cu requestId-ul din raspuns.");
  }
});

rnpmRouter.post("/backups/restore", requireDesktopHeader, requireRole("admin", "user"), limitSmall, async (c) => {
  const body = await parseJsonBody(c);
  if (body === null) return invalidJson(c);
  const name = (body as { name?: unknown })?.name;
  if (typeof name !== "string" || name.length === 0) {
    return invalidParams(c, "Nume backup lipsa");
  }
  const requestedOwner = (body as { ownerId?: unknown }).ownerId;
  if (requestedOwner !== undefined && typeof requestedOwner !== "string") {
    return invalidParams(c, "ownerId invalid");
  }
  let owner: string;
  try {
    owner = resolveBackupOwner(c, requestedOwner);
  } catch {
    return invalidParams(c, "ownerId invalid");
  }
  const caller = getOwnerId(c);
  try {
    const { preRestoreName } = await restoreRnpmFromBackup(owner, name);
    // Rev. 4 (Codex): mutatia e COMISA — un esec al scrierii de audit nu are
    // voie sa rastoarne rezultatul in 409/500 (clientul ar repeta un restore
    // distructiv). Acelasi contract ca site-urile post-mutatie din admin.ts.
    recordAuditSafe(c, "backup.rnpm.restore", {
      targetKind: "backup",
      targetId: name,
      // B1: owner_id (coloana indexata) trebuie sa fie ownerul AFECTAT de
      // restore, nu callerul admin — altfel query-urile owner-scoped pe
      // audit_log nu gasesc evenimentul.
      ownerId: owner,
      detail: { preRestoreName, targetOwnerId: owner === caller ? undefined : owner },
    });
    return c.json({ ok: true, preRestoreName });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Eroare restore";
    recordAuditSafe(c, "backup.rnpm.restore", {
      targetKind: "backup",
      targetId: name,
      ownerId: owner,
      outcome: isTypedMaintenanceError(e) ? "denied" : "error",
      detail: { error: msg, targetOwnerId: owner === caller ? undefined : owner },
    });
    // Clasificare: input invalid = 400; concurenta = 409; restul = 500.
    if (e instanceof BackupValidationError) return invalidParams(c, msg);
    if (e instanceof RnpmSearchActiveError) return c.json(fail(ErrorCodes.SEARCH_ACTIVE, msg, c), 409);
    // Restore concurent pe acelasi owner / shutdown => 409/503 central.
    rethrowTypedMaintenanceError(e);
    console.error("[rnpm] backups restore failed:", e);
    return internalError(c, "Eroare interna. Reincearca sau contacteaza administratorul cu requestId-ul din raspuns.");
  }
});

rnpmRouter.delete("/backups", requireDesktopHeader, requireRole("admin", "user"), async (c) => {
  // B1: owner-ul se rezolva INAINTE de try, ca eroarea tipata de mai jos
  // (denied vs error) si audit-ul din catch sa poata purta ownerId: owner —
  // acelasi pattern ca /backups/restore.
  let owner: string;
  try {
    owner = resolveBackupOwner(c, c.req.query("ownerId"));
  } catch (e) {
    return invalidParams(c, e instanceof Error ? e.message : "ownerId invalid");
  }
  try {
    const deleted = await deleteRnpmBackups(owner);
    recordAuditSafe(c, "backup.rnpm.delete_all", {
      targetKind: "backup",
      ownerId: owner,
      detail: { deleted, targetOwnerId: owner === getOwnerId(c) ? undefined : owner },
    });
    return c.json({ deleted });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Eroare stergere backups";
    recordAuditSafe(c, "backup.rnpm.delete_all", {
      targetKind: "backup",
      ownerId: owner,
      outcome: isTypedMaintenanceError(e) ? "denied" : "error",
      detail: { error: msg },
    });
    rethrowTypedMaintenanceError(e);
    console.error("[rnpm] backups delete-all failed:", e);
    return internalError(c, "Eroare interna. Reincearca sau contacteaza administratorul cu requestId-ul din raspuns.");
  }
});

rnpmRouter.post("/open-backups-folder", requireDesktopHeader, requireRole("admin", "user"), async (c) => {
  // v2.43.0 (rnpm-split): jail-ul de backup al userului local.
  const dir = getRnpmBackupDir(getOwnerId(c));
  try {
    await mkdir(dir, { recursive: true });
    const electron = require("electron") as { shell?: { openPath?: (p: string) => Promise<string> } };
    if (!electron?.shell?.openPath) {
      return desktopOnly(c);
    }
    const err = await electron.shell.openPath(dir);
    if (err) {
      console.error("[rnpm] open-backups-folder failed:", err);
      return internalError(
        c,
        "Eroare interna. Reincearca sau contacteaza administratorul cu requestId-ul din raspuns."
      );
    }
    return c.json({ ok: true });
  } catch (e) {
    console.error("[rnpm] open-backups-folder failed:", e);
    return internalError(c, "Eroare interna. Reincearca sau contacteaza administratorul cu requestId-ul din raspuns.");
  }
});

rnpmRouter.delete("/saved/:id", (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return invalidParams(c, "ID invalid");
  const ok = deleteAviz(id, getOwnerId(c));
  recordAudit(c, "aviz.delete", {
    targetKind: "aviz",
    targetId: String(id),
    outcome: ok ? "ok" : "error",
    detail: { found: ok },
  });
  return c.json({ deleted: ok });
});

rnpmRouter.post("/saved/export", limitExport, async (c) => {
  const body = await parseJsonBody(c);
  if (body === null) return invalidJson(c);
  const { ids } = (body ?? {}) as { ids?: unknown };
  if (!Array.isArray(ids) || ids.length === 0) return invalidParams(c, "Lista id-uri goala");
  const numIds = ids.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (numIds.length === 0) return invalidParams(c, "Lista id-uri invalida");
  if (numIds.length > 5000) return invalidParams(c, "Maxim 5000 avize per export");
  return c.json({ items: getAvizeByIds(numIds, getOwnerId(c)) });
});

// Server-side XLSX export. Replaces the frontend Web Worker build, which OOM'd
// the Electron renderer at ~150 avizi (peak heap ~2.7GB). Backend builds the
// workbook and streams the binary back; frontend just triggers the download.
//
// Body: { ids: number[]; searchType?: string }. Same 5000-id cap as /saved/export.
// `searchType` controls layout (sheet count + columns) for "specifice" vs others.
rnpmRouter.post("/saved/export.xlsx", limitExport, async (c) => {
  const body = await parseJsonBody(c);
  if (body === null) return invalidJson(c);
  const { ids, searchType } = (body ?? {}) as { ids?: unknown; searchType?: unknown };
  if (!Array.isArray(ids) || ids.length === 0) return invalidParams(c, "Lista id-uri goala");
  const numIds = ids.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (numIds.length === 0) return invalidParams(c, "Lista id-uri invalida");
  if (numIds.length > 5000) return invalidParams(c, "Maxim 5000 avize per export");
  const searchTypeStr =
    typeof searchType === "string" && searchType.length > 0 && searchType.length <= 64 ? searchType : undefined;

  const items = getAvizeByIds(numIds, getOwnerId(c));
  if (items.length === 0) return notFound(c, "Nicio inregistrare gasita");

  const result = await buildRnpmXlsx(items, searchTypeStr);
  const [{ createReadStream }, { unlink }, { Readable }] = await Promise.all([
    import("node:fs"),
    import("node:fs/promises"),
    import("node:stream"),
  ]);
  const fileStream = createReadStream(result.filepath);
  // Cleanup waits for stream close; a route-level finally would delete before the response is consumed.
  fileStream.once("close", () => {
    void unlink(result.filepath).catch(() => {});
  });

  // Content-Disposition: include both filename= (legacy fallback) and filename*=UTF-8 (RFC 5987)
  // so the frontend can read the name without round-tripping a separate metadata call.
  const safeAscii = result.filename.replace(/[^A-Za-z0-9._-]+/g, "_");
  c.header("Content-Type", result.mime);
  c.header("Content-Length", String(result.byteLength));
  c.header(
    "Content-Disposition",
    `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`
  );
  c.header("Cache-Control", "no-store");
  return c.body(Readable.toWeb(fileStream) as unknown as ReadableStream);
});

rnpmRouter.post("/saved/export.pdf", limitExport, async (c) => {
  const body = await parseJsonBody(c);
  if (body === null) return invalidJson(c);
  const { ids, searchType } = (body ?? {}) as { ids?: unknown; searchType?: unknown };
  if (!Array.isArray(ids) || ids.length === 0) return invalidParams(c, "Lista id-uri goala");
  const numIds = ids.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (numIds.length === 0) return invalidParams(c, "Lista id-uri invalida");
  if (numIds.length > 5000) return invalidParams(c, "Maxim 5000 avize per export");
  const searchTypeStr =
    typeof searchType === "string" && searchType.length > 0 && searchType.length <= 64 ? searchType : undefined;

  const items = getAvizeByIds(numIds, getOwnerId(c));
  if (items.length === 0) return notFound(c, "Nicio inregistrare gasita");

  const result = await buildRnpmPdf(items, searchTypeStr);
  const [{ createReadStream }, { unlink }, { Readable }] = await Promise.all([
    import("node:fs"),
    import("node:fs/promises"),
    import("node:stream"),
  ]);
  const fileStream = createReadStream(result.filepath);
  // Cleanup waits for stream close; a route-level finally would delete before the response is consumed.
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
});

// Cursor pagination is intentional here — deliberate deviation from the
// CLAUDE.md "offset-based on listari principale" guideline. RNPM searches is
// a personal history log (monotonically growing IDs, "load more" UX, no
// "page 5 of 12" indicator), where cursor wins on two counts:
//   1. Inserts at the head don't shift offsets of older rows mid-scroll.
//   2. No SELECT COUNT(*) per page hit — `total` is meaningless for a stream.
// The offset rule applies to enumerable listings (admin users, audit,
// monitoring jobs, alerts inbox) where total + page numbers matter for the
// UI. Locked by characterization test in routes/rnpm.contract.test.ts.
rnpmRouter.get("/searches", (c) => {
  const limit = Number(c.req.query("limit") ?? 50);
  const cursorStr = c.req.query("cursor");
  const cursor = cursorStr ? Number(cursorStr) : null;
  return c.json(
    getSearches({
      ownerId: getOwnerId(c),
      // v2.34.0 P1-3: clamp limit server-side la MAX_PAGE_SIZE (200).
      limit: clampPageSize(limit, 50),
      cursor: Number.isFinite(cursor as number) ? (cursor as number) : null,
    })
  );
});

rnpmRouter.delete("/searches/:id", (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return invalidParams(c, "ID invalid");
  const deleted = deleteSearch(id, getOwnerId(c));
  recordAudit(c, "search.delete", {
    targetKind: "search",
    targetId: String(id),
    outcome: deleted ? "ok" : "error",
    detail: { found: deleted },
  });
  return c.json({ deleted });
});

rnpmRouter.post("/captcha/balance", limitSmall, async (c) => {
  // Resolve captcha config first: in web mode without tenant key configured,
  // the 501 CAPTCHA_NOT_CONFIGURED response is the canonical signal regardless
  // of the caller's role. This keeps the route contract identical whether the
  // request hits before or after the admin gate.
  const resolved = resolveCaptchaKeyForRoute(c);
  if (resolved.source === "tenant" && !resolved.ok) return resolved.response;
  // In web mode the captcha key is a tenant-shared admin secret; only admins
  // can read the balance number. Non-admin web users get a 403 with a generic
  // message — exposing the balance leaks how much the tenant spends and could
  // be used to time fraud / probe the tenant wallet.
  if (getAuthMode() === "web") {
    const user = getUserById(getOwnerId(c));
    if (!user || user.role !== "admin") {
      return c.json(fail("forbidden", "Doar adminul poate vedea soldul captcha.", c), 403);
    }
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    if (resolved.source === "body") return c.json(fail(ErrorCodes.INVALID_JSON, "JSON invalid", c), 400);
    body = {};
  }
  const { captchaKey, captchaProvider } = (body ?? {}) as { captchaKey?: unknown; captchaProvider?: unknown };
  const effectiveKey = resolved.source === "tenant" ? resolved.captchaKey : captchaKey;
  const effectiveProvider = resolved.source === "tenant" ? resolved.provider : parseProvider(captchaProvider);
  if (typeof effectiveKey !== "string") return c.json(fail(ErrorCodes.INVALID_CAPTCHA_KEY, "Cheie lipsa", c), 400);
  try {
    const balance = await getCaptchaBalance(effectiveKey, effectiveProvider);
    return c.json({ balance });
  } catch (e) {
    if (e instanceof CaptchaInsufficientFundsError) {
      c.header("Retry-After", "0");
      return c.json(fail(ErrorCodes.INSUFFICIENT_FUNDS, e.message, c), 402);
    }
    const msg = e instanceof Error ? e.message : "Eroare";
    return c.json(fail(ErrorCodes.CAPTCHA_BALANCE_UNAVAILABLE, msg, c), 400);
  }
});

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import { stat } from "node:fs/promises";
import {
  executeSearch,
  executeBulkSearch,
  type BulkSearchItem,
  type BulkProgress,
} from "../services/rnpmSearchService.ts";
import { defaultRnpmClient, type RnpmSearchType } from "../services/rnpmClient.ts";
import { getCaptchaBalance, type CaptchaProvider } from "../services/captchaSolver.ts";
import { getDbPath, compactDb } from "../db/schema.ts";
import { getBackupDir, deleteAllBackups, listBackupsWithMeta, restoreFromBackup } from "../db/backup.ts";
import { recordAudit } from "../db/auditRepository.ts";
import { mkdir } from "node:fs/promises";
import { getOwnerId } from "../middleware/owner.ts";
import { requireRole } from "../middleware/requireRole.ts";
import { getAuthMode } from "../auth/config.ts";

function parseProvider(v: unknown): CaptchaProvider | undefined {
  return v === "capsolver" || v === "2captcha" ? v : undefined;
}

// Body size limits — prevent DoS via oversized POST payloads
const SEARCH_BODY_LIMIT = 64 * 1024;    // 64KB: single search params
const BULK_BODY_LIMIT = 512 * 1024;     // 512KB: up to 200 bulk items
const EXPORT_BODY_LIMIT = 64 * 1024;    // 64KB: up to 500 numeric ids
const SMALL_BODY_LIMIT = 4 * 1024;      // 4KB: captcha balance

const bodyTooLarge = (c: import("hono").Context) => c.json({ error: "Payload prea mare" }, 413);
const limitSearch = bodyLimit({ maxSize: SEARCH_BODY_LIMIT, onError: bodyTooLarge });
const limitBulk = bodyLimit({ maxSize: BULK_BODY_LIMIT, onError: bodyTooLarge });
const limitExport = bodyLimit({ maxSize: EXPORT_BODY_LIMIT, onError: bodyTooLarge });
const limitSmall = bodyLimit({ maxSize: SMALL_BODY_LIMIT, onError: bodyTooLarge });

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

const SSE_TIMEOUT_MS = 600000; // 10 min hard cap per bulk stream
import {
  getAvize,
  getAvizById,
  deleteAviz,
  deleteAllAvize,
  deleteAvizeByIds,
  getAvizeByIds,
  getAvizStats,
} from "../db/avizRepository.ts";
import { getSearches, deleteSearch } from "../db/searchRepository.ts";

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
const inflightRequests = new Map<string, Promise<unknown>>();
function inflightKey(ownerId: string, clientRequestId: string): string {
  return `${ownerId}:${clientRequestId}`;
}
function parseClientRequestId(body: Record<string, unknown> | null): string | null {
  const v = body?.clientRequestId;
  if (typeof v !== "string") return null;
  if (v.length === 0 || v.length > 128) return null;
  return v;
}

// Web-readiness closure (#12): in `desktop` mode, `captchaKey` vine din
// safeStorage in renderer si e trimis cu fiecare request — comportament
// pastrat. In `web` mode browserul nu trebuie sa puna cheia in body
// (localStorage/inspectabil), asa ca rutele care primesc `captchaKey`
// raspund 501 pana cand exista per-user server-side storage. Rutele de
// `/saved`, `/searches`, `/stats`, `/backups/*` raman functionale; doar
// caile care fac call efectiv la captcha provider sunt blocate.
function rejectCaptchaKeyInWebMode(c: import("hono").Context): Response | null {
  if (getAuthMode() !== "web") return null;
  return c.json(
    {
      error:
        "RNPM in web mode necesita stocare server-side a cheii captcha (neimplementat in v2.11.0). Folositi desktop sau asteptati per-user key storage.",
    },
    501,
  );
}

rnpmRouter.post("/search", limitSearch, async (c) => {
  const webGate = rejectCaptchaKeyInWebMode(c);
  if (webGate) return webGate;
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "JSON invalid" }, 400); }
  const { type, params, captchaKey, captchaProvider, fallback2CaptchaKey, captchaMode, startRnpmPage, batchSize, gcode, searchId } = (body ?? {}) as {
    type?: unknown; params?: unknown; captchaKey?: unknown; captchaProvider?: unknown; fallback2CaptchaKey?: unknown;
    captchaMode?: unknown;
    startRnpmPage?: unknown; batchSize?: unknown; gcode?: unknown; searchId?: unknown;
  };

  if (!isValidType(type)) return c.json({ error: "Tip cautare invalid" }, 400);
  if (!params || typeof params !== "object") return c.json({ error: "Parametri cautare lipsa" }, 400);
  const paramsErr = validateParamsDepth(params);
  if (paramsErr) return c.json({ error: paramsErr }, 400);
  if (typeof captchaKey !== "string" || captchaKey.trim().length < 10) {
    return c.json({ error: "Cheie captcha lipsa sau invalida" }, 400);
  }
  const provider = parseProvider(captchaProvider);
  const startPage = typeof startRnpmPage === "number" && startRnpmPage >= 1 && startRnpmPage <= 500 ? startRnpmPage : 1;
  const batch = typeof batchSize === "number" && batchSize >= 1 && batchSize <= 200 ? batchSize : 25;
  const existingGcode = typeof gcode === "string" && gcode.length > 0 ? gcode : undefined;
  const existingSearchId = typeof searchId === "number" && Number.isFinite(searchId) ? searchId : undefined;

  const ownerId = getOwnerId(c);
  const clientRequestId = parseClientRequestId(body as Record<string, unknown> | null);
  const dedupKey = clientRequestId ? inflightKey(ownerId, clientRequestId) : null;
  if (dedupKey && inflightRequests.has(dedupKey)) {
    return c.json({ error: "Cerere deja in curs (dedup clientRequestId)" }, 409);
  }

  const run = executeSearch({
    type,
    params: params as Parameters<typeof executeSearch>[0]["params"],
    captchaKey,
    captchaProvider: provider,
    fallback2CaptchaKey: typeof fallback2CaptchaKey === "string" ? fallback2CaptchaKey : undefined,
    captchaMode: captchaMode === "race" ? "race" : "sequential",
    ownerId,
    startRnpmPage: startPage,
    batchSize: batch,
    existingGcode,
    existingSearchId,
    signal: c.req.raw.signal,
  });
  if (dedupKey) inflightRequests.set(dedupKey, run);

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
      return new Response(JSON.stringify({ error: "Cautare oprita" }), {
        status: 499,
        headers: { "Content-Type": "application/json" },
      });
    }
    const msg = e instanceof Error ? e.message : "Eroare necunoscuta";
    console.error("[rnpm/search]", msg);
    return c.json({ error: msg }, 500);
  } finally {
    if (dedupKey) inflightRequests.delete(dedupKey);
  }
});

rnpmRouter.post("/bulk", limitBulk, async (c) => {
  const webGate = rejectCaptchaKeyInWebMode(c);
  if (webGate) return webGate;
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "JSON invalid" }, 400); }
  const { items, captchaKey, captchaProvider, fallback2CaptchaKey, captchaMode } = (body ?? {}) as { items?: unknown; captchaKey?: unknown; captchaProvider?: unknown; fallback2CaptchaKey?: unknown; captchaMode?: unknown };

  if (!Array.isArray(items) || items.length === 0) return c.json({ error: "Lista cautari goala" }, 400);
  if (items.length > 200) return c.json({ error: "Maxim 200 cautari per bulk" }, 400);
  if (typeof captchaKey !== "string" || captchaKey.trim().length < 10) {
    return c.json({ error: "Cheie captcha lipsa sau invalida" }, 400);
  }
  const provider = parseProvider(captchaProvider);

  const ownerId = getOwnerId(c);
  const clientRequestId = parseClientRequestId(body as Record<string, unknown> | null);
  const dedupKey = clientRequestId ? inflightKey(ownerId, clientRequestId) : null;
  if (dedupKey && inflightRequests.has(dedupKey)) {
    return c.json({ error: "Bulk deja in curs (dedup clientRequestId)" }, 409);
  }

  const validItems: BulkSearchItem[] = [];
  for (const it of items) {
    const item = it as { type?: unknown; params?: unknown; label?: unknown };
    if (!isValidType(item.type)) return c.json({ error: "Tip cautare invalid in lista" }, 400);
    if (!item.params || typeof item.params !== "object") return c.json({ error: "Parametri invalidi" }, 400);
    const paramsErr = validateParamsDepth(item.params);
    if (paramsErr) return c.json({ error: paramsErr }, 400);
    validItems.push({
      type: item.type,
      params: item.params as BulkSearchItem["params"],
      label: typeof item.label === "string" ? item.label : undefined,
    });
  }

  return streamSSE(c, async (stream) => {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    c.req.raw.signal?.addEventListener?.("abort", onAbort);

    // SSE hard timeout — guarantee the stream never hangs indefinitely
    const timeoutHandle = setTimeout(() => controller.abort(), SSE_TIMEOUT_MS);

    const send = (p: BulkProgress) => stream.writeSSE({
      event: "progress",
      data: JSON.stringify(p),
    });

    const bulkRun = executeBulkSearch(
      validItems,
      captchaKey,
      ownerId,
      (p) => { void send(p); },
      defaultRnpmClient,
      controller.signal,
      provider,
      typeof fallback2CaptchaKey === "string" ? fallback2CaptchaKey : undefined,
      captchaMode === "race" ? "race" : "sequential"
    );
    if (dedupKey) inflightRequests.set(dedupKey, bulkRun);

    try {
      await bulkRun;
      await stream.writeSSE({ event: "complete", data: "{}" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await stream.writeSSE({ event: "error", data: JSON.stringify({ error: msg }) });
    } finally {
      clearTimeout(timeoutHandle);
      c.req.raw.signal?.removeEventListener?.("abort", onAbort);
      if (dedupKey) inflightRequests.delete(dedupKey);
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
    page: Number.isFinite(pageRaw) ? pageRaw : 0,
    pageSize: Number.isFinite(pageSizeRaw) ? pageSizeRaw : 25,
    searchType,
    activ,
    searchText,
    dataStart: c.req.query("dataStart") ?? undefined,
    dataStop: c.req.query("dataStop") ?? undefined,
    sortKey: sortKeyRaw && SORT_KEYS.has(sortKeyRaw) ? (sortKeyRaw as "id" | "identificator" | "search_type" | "data" | "tip" | "activ") : undefined,
    sortDir: sortDirRaw === "asc" || sortDirRaw === "desc" ? sortDirRaw : undefined,
  });
  return c.json(result);
});

rnpmRouter.get("/saved/:id", (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "ID invalid" }, 400);
  const aviz = getAvizById(id);
  if (!aviz) return c.json({ error: "Aviz inexistent" }, 404);
  return c.json(aviz);
});

rnpmRouter.delete("/saved/all", requireRole("admin"), (c) => {
  const count = deleteAllAvize();
  // "Sterge baza" must actually free disk space, not just remove rows — run VACUUM +
  // WAL truncate so the file shrinks from ~hundreds of MB back to the schema size.
  try { compactDb(); } catch (e) { console.warn("[rnpm] compact after delete-all failed:", e); }
  // Audit 2026-04-29 #15: ops destructive masive trebuie reconstruibile.
  recordAudit(c, "aviz.delete_all", {
    targetKind: "aviz",
    detail: { deleted: count },
  });
  return c.json({ deleted: count });
});

rnpmRouter.post("/saved/delete-batch", limitExport, async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "JSON invalid" }, 400); }
  const { ids } = (body ?? {}) as { ids?: unknown };
  if (!Array.isArray(ids) || ids.length === 0) return c.json({ error: "Lista id-uri goala" }, 400);
  const numIds = ids.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (numIds.length === 0) return c.json({ error: "Lista id-uri invalida" }, 400);
  if (numIds.length > 500) return c.json({ error: "Maxim 500 avize per batch" }, 400);
  const deleted = deleteAvizeByIds(numIds);
  recordAudit(c, "aviz.delete_batch", {
    targetKind: "aviz",
    detail: { requested: numIds.length, deleted },
  });
  return c.json({ deleted });
});

rnpmRouter.get("/stats", async (c) => {
  const stats = getAvizStats();
  const dbPath = getDbPath();
  // CP-B4: async fs so handler does not block the event loop under concurrency (web mode).
  const sizeOf = async (p: string): Promise<number> => {
    try { return (await stat(p)).size; } catch { return 0; }
  };
  const [main, wal, shm] = await Promise.all([
    sizeOf(dbPath),
    sizeOf(`${dbPath}-wal`),
    sizeOf(`${dbPath}-shm`),
  ]);
  return c.json({ ...stats, db: { path: dbPath, sizeBytes: main + wal + shm } });
});

// Desktop-only: reveal the DB file in the system file manager via Electron shell.
// `require("electron")` is marked external at bundle time (scripts/build.js) so it
// resolves at runtime inside the main process; web deployments will hit the catch
// and return 501.
rnpmRouter.post("/open-db-folder", requireRole("admin"), (c) => {
  const dbPath = getDbPath();
  try {
    // esbuild emits `require("electron")` verbatim in the CJS bundle because
    // electron is marked external (scripts/build.js). At runtime inside Electron's
    // main process the CJS loader resolves it; outside Electron it throws.
    const electron = require("electron") as { shell?: { showItemInFolder?: (p: string) => void } };
    if (!electron?.shell?.showItemInFolder) {
      return c.json({ error: "Functie disponibila doar in Electron" }, 501);
    }
    electron.shell.showItemInFolder(dbPath);
    return c.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Eroare deschidere folder";
    return c.json({ error: msg }, 500);
  }
});

rnpmRouter.post("/compact", requireRole("admin"), (c) => {
  try {
    const result = compactDb();
    return c.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Eroare compactare baza";
    return c.json({ error: msg }, 500);
  }
});

// Tier 4 #21: destructive backup ops are audit-logged so a web/admin mode
// later can reconstruct who wiped/rolled back the database. Audit on both
// success and failure paths — a failed restore that left a pre-restore
// snapshot behind still matters for reconstruction.
rnpmRouter.delete("/backups", requireRole("admin"), async (c) => {
  try {
    const deleted = await deleteAllBackups();
    recordAudit(c, "backup.delete_all", {
      targetKind: "backup",
      detail: { deleted },
    });
    return c.json({ deleted });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Eroare stergere backups";
    recordAudit(c, "backup.delete_all", {
      targetKind: "backup",
      outcome: "error",
      detail: { error: msg },
    });
    return c.json({ error: msg }, 500);
  }
});

rnpmRouter.get("/backups", requireRole("admin"), async (c) => {
  try {
    const backups = await listBackupsWithMeta();
    return c.json({ backups });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Eroare listare backups";
    return c.json({ error: msg }, 500);
  }
});

rnpmRouter.post("/backups/restore", requireRole("admin"), limitSmall, async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "JSON invalid" }, 400); }
  const name = (body as { name?: unknown })?.name;
  if (typeof name !== "string" || name.length === 0) {
    return c.json({ error: "Nume backup lipsa" }, 400);
  }
  try {
    const { preRestoreName } = await restoreFromBackup(name);
    recordAudit(c, "backup.restore", {
      targetKind: "backup",
      targetId: name,
      detail: { preRestoreName },
    });
    return c.json({ ok: true, preRestoreName });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Eroare restore";
    recordAudit(c, "backup.restore", {
      targetKind: "backup",
      targetId: name,
      outcome: "error",
      detail: { error: msg },
    });
    return c.json({ error: msg }, 500);
  }
});

rnpmRouter.post("/open-backups-folder", requireRole("admin"), async (c) => {
  const dir = getBackupDir();
  try {
    await mkdir(dir, { recursive: true });
    const electron = require("electron") as { shell?: { openPath?: (p: string) => Promise<string> } };
    if (!electron?.shell?.openPath) {
      return c.json({ error: "Functie disponibila doar in Electron" }, 501);
    }
    const err = await electron.shell.openPath(dir);
    if (err) return c.json({ error: err }, 500);
    return c.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Eroare deschidere folder backups";
    return c.json({ error: msg }, 500);
  }
});

rnpmRouter.delete("/saved/:id", (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "ID invalid" }, 400);
  const ok = deleteAviz(id);
  recordAudit(c, "aviz.delete", {
    targetKind: "aviz",
    targetId: String(id),
    outcome: ok ? "ok" : "error",
    detail: { found: ok },
  });
  return c.json({ deleted: ok });
});

rnpmRouter.post("/saved/export", limitExport, async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "JSON invalid" }, 400); }
  const { ids } = (body ?? {}) as { ids?: unknown };
  if (!Array.isArray(ids) || ids.length === 0) return c.json({ error: "Lista id-uri goala" }, 400);
  const numIds = ids.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (numIds.length === 0) return c.json({ error: "Lista id-uri invalida" }, 400);
  if (numIds.length > 500) return c.json({ error: "Maxim 500 avize per export" }, 400);
  return c.json({ items: getAvizeByIds(numIds) });
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
  return c.json(getSearches({
    limit: Number.isFinite(limit) ? limit : 50,
    cursor: Number.isFinite(cursor as number) ? (cursor as number) : null,
  }));
});

rnpmRouter.delete("/searches/:id", (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "ID invalid" }, 400);
  const deleted = deleteSearch(id);
  recordAudit(c, "search.delete", {
    targetKind: "search",
    targetId: String(id),
    outcome: deleted ? "ok" : "error",
    detail: { found: deleted },
  });
  return c.json({ deleted });
});

rnpmRouter.post("/captcha/balance", limitSmall, async (c) => {
  const webGate = rejectCaptchaKeyInWebMode(c);
  if (webGate) return webGate;
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "JSON invalid" }, 400); }
  const { captchaKey, captchaProvider } = (body ?? {}) as { captchaKey?: unknown; captchaProvider?: unknown };
  if (typeof captchaKey !== "string") return c.json({ error: "Cheie lipsa" }, 400);
  try {
    const balance = await getCaptchaBalance(captchaKey, parseProvider(captchaProvider));
    return c.json({ balance });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Eroare";
    return c.json({ error: msg }, 400);
  }
});

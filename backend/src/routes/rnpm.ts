import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import fs from "fs";
import {
  executeSearch,
  executeBulkSearch,
  type BulkSearchItem,
  type BulkProgress,
} from "../services/rnpmSearchService.ts";
import { defaultRnpmClient, type RnpmSearchType } from "../services/rnpmClient.ts";
import { getCaptchaBalance, type CaptchaProvider } from "../services/captchaSolver.ts";
import { getDbPath } from "../db/schema.ts";

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

rnpmRouter.post("/search", limitSearch, async (c) => {
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

  try {
    const result = await executeSearch({
      type,
      params: params as Parameters<typeof executeSearch>[0]["params"],
      captchaKey,
      captchaProvider: provider,
      fallback2CaptchaKey: typeof fallback2CaptchaKey === "string" ? fallback2CaptchaKey : undefined,
      captchaMode: captchaMode === "race" ? "race" : "sequential",
      startRnpmPage: startPage,
      batchSize: batch,
      existingGcode,
      existingSearchId,
      signal: c.req.raw.signal,
    });
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
      return c.json({ error: "Cautare oprita" }, 500);
    }
    const msg = e instanceof Error ? e.message : "Eroare necunoscuta";
    console.error("[rnpm/search]", msg);
    return c.json({ error: msg }, 500);
  }
});

rnpmRouter.post("/bulk", limitBulk, async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "JSON invalid" }, 400); }
  const { items, captchaKey, captchaProvider, fallback2CaptchaKey, captchaMode } = (body ?? {}) as { items?: unknown; captchaKey?: unknown; captchaProvider?: unknown; fallback2CaptchaKey?: unknown; captchaMode?: unknown };

  if (!Array.isArray(items) || items.length === 0) return c.json({ error: "Lista cautari goala" }, 400);
  if (items.length > 200) return c.json({ error: "Maxim 200 cautari per bulk" }, 400);
  if (typeof captchaKey !== "string" || captchaKey.trim().length < 10) {
    return c.json({ error: "Cheie captcha lipsa sau invalida" }, 400);
  }
  const provider = parseProvider(captchaProvider);

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

    try {
      await executeBulkSearch(validItems, captchaKey, "local", (p) => { void send(p); }, defaultRnpmClient, controller.signal, provider, typeof fallback2CaptchaKey === "string" ? fallback2CaptchaKey : undefined, captchaMode === "race" ? "race" : "sequential");
      await stream.writeSSE({ event: "complete", data: "{}" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await stream.writeSSE({ event: "error", data: JSON.stringify({ error: msg }) });
    } finally {
      clearTimeout(timeoutHandle);
      c.req.raw.signal?.removeEventListener?.("abort", onAbort);
    }
  });
});

rnpmRouter.get("/saved", (c) => {
  const limit = Number(c.req.query("limit") ?? 50);
  const cursorStr = c.req.query("cursor");
  const cursor = cursorStr ? Number(cursorStr) : null;
  const searchType = c.req.query("searchType") ?? undefined;
  const activStr = c.req.query("activ");
  const activ = activStr == null ? undefined : activStr === "true";
  const searchText = c.req.query("q") ?? undefined;

  const page = getAvize({
    limit: Number.isFinite(limit) ? limit : 50,
    cursor: Number.isFinite(cursor as number) ? (cursor as number) : null,
    searchType,
    activ,
    searchText,
    dataStart: c.req.query("dataStart") ?? undefined,
    dataStop: c.req.query("dataStop") ?? undefined,
  });
  return c.json(page);
});

rnpmRouter.get("/saved/:id", (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "ID invalid" }, 400);
  const aviz = getAvizById(id);
  if (!aviz) return c.json({ error: "Aviz inexistent" }, 404);
  return c.json(aviz);
});

rnpmRouter.delete("/saved/all", (c) => {
  const count = deleteAllAvize();
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
  return c.json({ deleted: deleteAvizeByIds(numIds) });
});

rnpmRouter.get("/stats", (c) => {
  const stats = getAvizStats();
  const dbPath = getDbPath();
  const sizeOf = (p: string): number => {
    try { return fs.statSync(p).size; } catch { return 0; }
  };
  const bytes = sizeOf(dbPath) + sizeOf(`${dbPath}-wal`) + sizeOf(`${dbPath}-shm`);
  return c.json({ ...stats, db: { path: dbPath, sizeBytes: bytes } });
});

// Desktop-only: reveal the DB file in the system file manager via Electron shell.
// `require("electron")` is marked external at bundle time (scripts/build.js) so it
// resolves at runtime inside the main process; web deployments will hit the catch
// and return 501.
rnpmRouter.post("/open-db-folder", (c) => {
  const dbPath = getDbPath();
  try {
    // esbuild emits `require("electron")` verbatim in the CJS bundle because
    // electron is marked external (scripts/build.js). At runtime inside Electron's
    // main process the CJS loader resolves it; outside Electron it throws.
    // @ts-expect-error `require` is available at runtime in the bundled CJS output.
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

rnpmRouter.delete("/saved/:id", (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "ID invalid" }, 400);
  const ok = deleteAviz(id);
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
  return c.json({ deleted: deleteSearch(id) });
});

rnpmRouter.post("/captcha/balance", limitSmall, async (c) => {
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

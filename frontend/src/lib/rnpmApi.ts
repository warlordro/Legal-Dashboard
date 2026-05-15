import { apiFetch } from "@/lib/api";
import type {
  RnpmSearchType,
  RnpmSearchParams,
  RnpmSearchResponse,
  RnpmAvizRecord,
  RnpmAvizFull,
  RnpmOffsetPage,
  RnpmSavedSortKey,
  RnpmSavedSortDir,
  RnpmBulkProgress,
  RnpmBulkItem,
  RnpmStats,
  RnpmSplitProgress,
  RnpmSplitResult,
} from "@/types/rnpm";

// Aruncata cand backendul raspunde 400 cu code:"limit_exceeded" pe /search.
// Frontendul foloseste `total` + `splittable.type` ca sa propuna split via tipInscriere.
export class RnpmLimitExceededError extends Error {
  readonly code = "limit_exceeded" as const;
  readonly total: number | undefined;
  readonly limit: number | undefined;
  readonly splittableType: RnpmSearchType;
  constructor(message: string, total: number | undefined, limit: number | undefined, splittableType: RnpmSearchType) {
    super(message);
    this.name = "RnpmLimitExceededError";
    this.total = total;
    this.limit = limit;
    this.splittableType = splittableType;
  }
}

// v2.24.0 - filtru text peste rezultatele unei cautari RNPM.
// Spec: docs/superpowers/specs/2026-05-13-rnpm-results-text-filter-design.md
export interface RnpmResultsFilterResponse {
  matchedAvizIds: number[];
  matchedCount: number;
  totalInSearch: number;
  missingDetails: number;
  truncated: boolean;
}

export class RnpmFilterDisabledError extends Error {
  readonly code = "FILTER_DISABLED" as const;
  constructor(message: string) {
    super(message);
    this.name = "RnpmFilterDisabledError";
  }
}

const BASE = "/api/rnpm";

export async function filterRnpmResults(
  searchId: number,
  q: string,
  signal?: AbortSignal
): Promise<RnpmResultsFilterResponse> {
  const res = await apiFetch(`${BASE}/search/${searchId}/filter`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q }),
    signal,
  });
  if (!res.ok) {
    let data: { error?: string; code?: string } | null = null;
    try {
      data = (await res.json()) as { error?: string; code?: string };
    } catch {
      throw new Error(`Eroare server (${res.status})`);
    }
    const errorMsg = data?.error ?? "Eroare necunoscuta";
    if (res.status === 503 && data?.code === "FILTER_DISABLED") {
      throw new RnpmFilterDisabledError(errorMsg);
    }
    throw new Error(errorMsg);
  }
  return (await res.json()) as RnpmResultsFilterResponse;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    const snippet = text.slice(0, 300).trim();
    throw new Error(res.ok ? "Raspuns invalid" : `Eroare server (${res.status}): ${snippet || "(corp gol)"}`);
  }
  if (!res.ok) {
    // v2.14.0 envelope: error e obiect { code, message }; legacy: string
    const raw = (data as { error?: unknown })?.error;
    let err: string;
    if (typeof raw === "string") err = raw;
    else if (raw && typeof raw === "object" && typeof (raw as { message?: unknown }).message === "string") {
      err = (raw as { message: string }).message;
    } else err = `Eroare (${res.status})`;
    throw new Error(err);
  }
  return data as T;
}

export type CaptchaProvider = "2captcha" | "capsolver";
export type CaptchaMode = "sequential" | "race";

export interface RnpmSearchOptions {
  startRnpmPage?: number;
  batchSize?: number;
  gcode?: string;
  searchId?: number;
  captchaProvider?: CaptchaProvider;
  fallback2CaptchaKey?: string;
  captchaMode?: CaptchaMode;
}

export async function rnpmSearch(
  type: RnpmSearchType,
  params: RnpmSearchParams,
  captchaKey: string,
  opts: RnpmSearchOptions = {},
  signal?: AbortSignal
): Promise<RnpmSearchResponse> {
  const res = await apiFetch(`${BASE}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, params, captchaKey, ...opts }),
    signal,
  });
  // Special-case 400 + code:"limit_exceeded" — escape din jsonOrThrow inainte de a colapsa eroarea.
  if (res.status === 400) {
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    if (parsed && typeof parsed === "object") {
      const obj = parsed as {
        error?: string;
        code?: string;
        total?: number;
        limit?: number;
        splittable?: { type?: string };
      };
      if (obj.code === "limit_exceeded") {
        const splitType = (obj.splittable?.type as RnpmSearchType) ?? type;
        throw new RnpmLimitExceededError(obj.error ?? "Cap rezultate depasit", obj.total, obj.limit, splitType);
      }
      throw new Error(obj.error ?? `Eroare (${res.status})`);
    }
    throw new Error(`Eroare server (${res.status})`);
  }
  return jsonOrThrow<RnpmSearchResponse>(res);
}

export async function rnpmSplitSearch(
  type: RnpmSearchType,
  baseParams: RnpmSearchParams,
  subTypeLabels: string[],
  captchaKey: string,
  onProgress: (p: RnpmSplitProgress) => void,
  signal?: AbortSignal,
  captchaProvider?: CaptchaProvider,
  fallback2CaptchaKey?: string,
  captchaMode?: CaptchaMode
): Promise<RnpmSplitResult> {
  const res = await apiFetch(`${BASE}/search-split`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type,
      baseParams,
      subTypeLabels,
      captchaKey,
      captchaProvider,
      fallback2CaptchaKey,
      captchaMode,
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Eroare split (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let finalResult: RnpmSplitResult | null = null;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let idx: number;
      while (true) {
        idx = buf.indexOf("\n\n");
        if (idx < 0) break;
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const eventMatch = chunk.match(/^event: (\S+)/m);
        const dataMatch = chunk.match(/^data: (.*)$/m);
        if (!eventMatch || !dataMatch) continue;
        const event = eventMatch[1];
        try {
          const data = JSON.parse(dataMatch[1]);
          if (event === "progress") onProgress(data as RnpmSplitProgress);
          else if (event === "complete") finalResult = data as RnpmSplitResult;
          else if (event === "error") throw new Error((data as { error?: string }).error ?? "Eroare split");
        } catch (e) {
          if (e instanceof Error && e.message !== "Unexpected end of JSON input") throw e;
        }
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* already closed */
    }
  }

  if (!finalResult) throw new Error("Split incomplet — niciun rezultat final primit");
  return finalResult;
}

export async function rnpmGetSaved(
  opts: {
    page?: number;
    pageSize?: number;
    searchType?: RnpmSearchType;
    activ?: boolean;
    q?: string;
    dataStart?: string;
    dataStop?: string;
    sortKey?: RnpmSavedSortKey;
    sortDir?: RnpmSavedSortDir;
  } = {}
): Promise<RnpmOffsetPage<RnpmAvizRecord>> {
  const qs = new URLSearchParams();
  if (opts.page != null) qs.set("page", String(opts.page));
  if (opts.pageSize != null) qs.set("pageSize", String(opts.pageSize));
  if (opts.searchType) qs.set("searchType", opts.searchType);
  if (opts.activ != null) qs.set("activ", String(opts.activ));
  if (opts.q) qs.set("q", opts.q);
  if (opts.dataStart) qs.set("dataStart", opts.dataStart);
  if (opts.dataStop) qs.set("dataStop", opts.dataStop);
  if (opts.sortKey) qs.set("sortKey", opts.sortKey);
  if (opts.sortDir) qs.set("sortDir", opts.sortDir);
  const res = await apiFetch(`${BASE}/saved?${qs.toString()}`);
  return jsonOrThrow<RnpmOffsetPage<RnpmAvizRecord>>(res);
}

// D: in-memory cache for aviz detail. Eliminates the 5-query SQL + round-trip lag
// when the user reopens the same aviz. TTL kept short so a concurrent bulk re-scrape
// that updates the aviz server-side surfaces within a minute.
const AVIZ_DETAIL_TTL_MS = 60_000;
const avizDetailCache = new Map<number, { data: RnpmAvizFull; at: number }>();

export async function rnpmGetAvizDetail(id: number): Promise<RnpmAvizFull> {
  const hit = avizDetailCache.get(id);
  if (hit && Date.now() - hit.at < AVIZ_DETAIL_TTL_MS) return hit.data;
  const res = await apiFetch(`${BASE}/saved/${id}`);
  const data = await jsonOrThrow<RnpmAvizFull>(res);
  avizDetailCache.set(id, { data, at: Date.now() });
  return data;
}

export async function rnpmDeleteAviz(id: number): Promise<boolean> {
  const res = await apiFetch(`${BASE}/saved/${id}`, { method: "DELETE" });
  const data = await jsonOrThrow<{ deleted: boolean }>(res);
  avizDetailCache.delete(id);
  return data.deleted;
}

export async function rnpmDeleteAllSaved(): Promise<number> {
  const res = await apiFetch(`${BASE}/saved/all`, { method: "DELETE" });
  const data = await jsonOrThrow<{ deleted: number }>(res);
  avizDetailCache.clear();
  return data.deleted;
}

export async function rnpmGetStats(): Promise<RnpmStats> {
  const res = await apiFetch(`${BASE}/stats`);
  return jsonOrThrow<RnpmStats>(res);
}

export async function rnpmDeleteAvizeBatch(ids: number[]): Promise<number> {
  const res = await apiFetch(`${BASE}/saved/delete-batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  const data = await jsonOrThrow<{ deleted: number }>(res);
  for (const id of ids) avizDetailCache.delete(id);
  return data.deleted;
}

export async function rnpmOpenDbFolder(): Promise<void> {
  const res = await apiFetch(`${BASE}/open-db-folder`, { method: "POST" });
  await jsonOrThrow<{ ok: true }>(res);
}

export async function rnpmOpenBackupsFolder(): Promise<void> {
  const res = await apiFetch(`${BASE}/open-backups-folder`, { method: "POST" });
  await jsonOrThrow<{ ok: true }>(res);
}

export interface RnpmCompactResult {
  beforeBytes: number;
  afterBytes: number;
  durationMs: number;
}

export async function rnpmCompactDb(): Promise<RnpmCompactResult> {
  const res = await apiFetch(`${BASE}/compact`, { method: "POST" });
  return jsonOrThrow<RnpmCompactResult>(res);
}

export async function rnpmDeleteBackups(): Promise<number> {
  const res = await apiFetch(`${BASE}/backups`, { method: "DELETE" });
  const data = await jsonOrThrow<{ deleted: number }>(res);
  return data.deleted;
}

export interface RnpmBackupEntry {
  name: string;
  sizeBytes: number;
  mtime: number;
}

export async function rnpmListBackups(): Promise<RnpmBackupEntry[]> {
  const res = await apiFetch(`${BASE}/backups`);
  const data = await jsonOrThrow<{ backups: RnpmBackupEntry[] }>(res);
  return data.backups;
}

export async function rnpmRestoreBackup(name: string): Promise<{ preRestoreName: string }> {
  const res = await apiFetch(`${BASE}/backups/restore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return jsonOrThrow<{ ok: true; preRestoreName: string }>(res);
}

// `rnpmExport` (detail fetch) chunkuieste transparent in loturi de 500 pentru a
// limita memoria pe response-uri mari. Hard cap pentru blob xlsx/pdf e mai mare
// (5000) — corespunde plafonului server din rnpm.ts.
const EXPORT_BATCH_SIZE = 500;
const EXPORT_BLOB_MAX = 5000;

export async function rnpmExport(ids: number[]): Promise<{ items: RnpmAvizFull[] }> {
  if (ids.length === 0) return { items: [] };
  const all: RnpmAvizFull[] = [];
  for (let i = 0; i < ids.length; i += EXPORT_BATCH_SIZE) {
    const chunk = ids.slice(i, i + EXPORT_BATCH_SIZE);
    const res = await apiFetch(`${BASE}/saved/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: chunk }),
    });
    const { items } = await jsonOrThrow<{ items: RnpmAvizFull[] }>(res);
    all.push(...items);
  }
  return { items: all };
}

// Server-side XLSX generation — backend builds the workbook from DB and streams
// the file back. Replaces the frontend Web Worker build which OOM'd the renderer
// at ~150 avizi. Caller passes the same id list and optional searchType (controls
// layout). Backend caps at EXPORT_BLOB_MAX per request (matches /saved/export).
function parseFilenameFromContentDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      // fall through to ascii branch
    }
  }
  const ascii = /filename="([^"]+)"/i.exec(header) ?? /filename=([^;]+)/i.exec(header);
  if (ascii) return ascii[1].trim();
  return fallback;
}

export async function rnpmExportXlsxBlob(
  ids: number[],
  searchType?: string
): Promise<{ blob: Blob; filename: string }> {
  if (ids.length === 0) throw new Error("Lista id-uri goala");
  if (ids.length > EXPORT_BLOB_MAX) {
    throw new Error(`Maxim ${EXPORT_BLOB_MAX} avize per export`);
  }
  const res = await apiFetch(`${BASE}/saved/export.xlsx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, searchType }),
  });
  if (!res.ok) {
    let msg = `Eroare server (${res.status})`;
    try {
      const data = (await res.json()) as { error?: unknown };
      if (data && typeof data.error === "string") msg = data.error;
      else if (
        data &&
        typeof data.error === "object" &&
        data.error &&
        "message" in data.error &&
        typeof (data.error as { message?: unknown }).message === "string"
      ) {
        msg = (data.error as { message: string }).message;
      }
    } catch {
      // server didn't return JSON (e.g. binary error page); fall back to status code
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const filename = parseFilenameFromContentDisposition(res.headers.get("Content-Disposition"), "rnpm_export.xlsx");
  return { blob, filename };
}

export async function rnpmExportPdfBlob(ids: number[], searchType?: string): Promise<{ blob: Blob; filename: string }> {
  if (ids.length === 0) throw new Error("Lista id-uri goala");
  if (ids.length > EXPORT_BLOB_MAX) {
    throw new Error(`Maxim ${EXPORT_BLOB_MAX} avize per export`);
  }
  const res = await apiFetch(`${BASE}/saved/export.pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, searchType }),
  });
  if (!res.ok) {
    let msg = `Eroare server (${res.status})`;
    try {
      const data = (await res.json()) as { error?: unknown };
      if (data && typeof data.error === "string") msg = data.error;
      else if (
        data &&
        typeof data.error === "object" &&
        data.error &&
        "message" in data.error &&
        typeof (data.error as { message?: unknown }).message === "string"
      ) {
        msg = (data.error as { message: string }).message;
      }
    } catch {
      // server didn't return JSON (e.g. binary error page); fall back to status code
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const filename = parseFilenameFromContentDisposition(res.headers.get("Content-Disposition"), "rnpm_export.pdf");
  return { blob, filename };
}

// Backend `/saved` cap = 200 items per page (avizRepository.ts). Folosit de
// export "exporta tot" — loop paginat pana acoperim `total`.
const SAVED_ENUM_PAGE_SIZE = 200;

export async function rnpmGetAllSaved(
  opts: Omit<Parameters<typeof rnpmGetSaved>[0], "page" | "pageSize">
): Promise<RnpmAvizRecord[]> {
  const all: RnpmAvizRecord[] = [];
  let page = 0;
  while (true) {
    const result = await rnpmGetSaved({ ...opts, page, pageSize: SAVED_ENUM_PAGE_SIZE });
    all.push(...result.items);
    if (result.items.length === 0 || all.length >= result.total) break;
    page++;
  }
  return all;
}

export async function rnpmCaptchaBalance(captchaKey: string, captchaProvider?: CaptchaProvider): Promise<number> {
  const res = await apiFetch(`${BASE}/captcha/balance`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ captchaKey, captchaProvider }),
  });
  const data = await jsonOrThrow<{ balance: number }>(res);
  return data.balance;
}

export async function rnpmBulkSearch(
  items: RnpmBulkItem[],
  captchaKey: string,
  onProgress: (p: RnpmBulkProgress) => void,
  signal?: AbortSignal,
  captchaProvider?: CaptchaProvider,
  fallback2CaptchaKey?: string,
  captchaMode?: CaptchaMode
): Promise<void> {
  const res = await apiFetch(`${BASE}/bulk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items, captchaKey, captchaProvider, fallback2CaptchaKey, captchaMode }),
    signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Eroare bulk (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let idx: number;
      while (true) {
        idx = buf.indexOf("\n\n");
        if (idx < 0) break;
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const eventMatch = chunk.match(/^event: (\S+)/m);
        const dataMatch = chunk.match(/^data: (.*)$/m);
        if (!eventMatch || !dataMatch) continue;
        const event = eventMatch[1];
        try {
          const data = JSON.parse(dataMatch[1]);
          if (event === "progress") onProgress(data as RnpmBulkProgress);
          else if (event === "error") throw new Error((data as { error?: string }).error ?? "Eroare bulk");
        } catch (e) {
          if (e instanceof Error && e.message !== "Unexpected end of JSON input") throw e;
        }
      }
    }
  } finally {
    // Release stream on abort / error / normal close (prevents reader leak on abrupt disconnect)
    try {
      await reader.cancel();
    } catch {
      /* already closed */
    }
  }
}

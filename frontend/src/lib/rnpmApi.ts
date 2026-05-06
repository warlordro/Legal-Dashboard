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

const BASE = "/api/rnpm";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch {
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
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    if (parsed && typeof parsed === "object") {
      const obj = parsed as { error?: string; code?: string; total?: number; limit?: number; splittable?: { type?: string } };
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
  captchaMode?: CaptchaMode,
): Promise<RnpmSplitResult> {
  const res = await apiFetch(`${BASE}/search-split`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, baseParams, subTypeLabels, captchaKey, captchaProvider, fallback2CaptchaKey, captchaMode }),
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
      while ((idx = buf.indexOf("\n\n")) >= 0) {
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
    try { await reader.cancel(); } catch { /* already closed */ }
  }

  if (!finalResult) throw new Error("Split incomplet — niciun rezultat final primit");
  return finalResult;
}

export async function rnpmGetSaved(opts: {
  page?: number;
  pageSize?: number;
  searchType?: RnpmSearchType;
  activ?: boolean;
  q?: string;
  dataStart?: string;
  dataStop?: string;
  sortKey?: RnpmSavedSortKey;
  sortDir?: RnpmSavedSortDir;
} = {}): Promise<RnpmOffsetPage<RnpmAvizRecord>> {
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

export async function rnpmExport(ids: number[]): Promise<{ items: RnpmAvizFull[] }> {
  const res = await apiFetch(`${BASE}/saved/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  return jsonOrThrow<{ items: RnpmAvizFull[] }>(res);
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
  captchaMode?: CaptchaMode,
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
      while ((idx = buf.indexOf("\n\n")) >= 0) {
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
    try { await reader.cancel(); } catch { /* already closed */ }
  }
}


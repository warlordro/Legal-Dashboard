import type {
  RnpmSearchType,
  RnpmSearchParams,
  RnpmSearchResponse,
  RnpmAvizRecord,
  RnpmAvizFull,
  RnpmCursorPage,
  RnpmBulkProgress,
  RnpmBulkItem,
  RnpmStats,
} from "@/types/rnpm";

const BASE = "/api/rnpm";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch {
    const snippet = text.slice(0, 300).trim();
    throw new Error(res.ok ? "Raspuns invalid" : `Eroare server (${res.status}): ${snippet || "(corp gol)"}`);
  }
  if (!res.ok) {
    const err = (data as { error?: string })?.error ?? `Eroare (${res.status})`;
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
  const res = await fetch(`${BASE}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, params, captchaKey, ...opts }),
    signal,
  });
  return jsonOrThrow<RnpmSearchResponse>(res);
}

export async function rnpmGetSaved(opts: {
  limit?: number;
  cursor?: number | null;
  searchType?: RnpmSearchType;
  activ?: boolean;
  q?: string;
  dataStart?: string;
  dataStop?: string;
} = {}): Promise<RnpmCursorPage<RnpmAvizRecord>> {
  const qs = new URLSearchParams();
  if (opts.limit) qs.set("limit", String(opts.limit));
  if (opts.cursor != null) qs.set("cursor", String(opts.cursor));
  if (opts.searchType) qs.set("searchType", opts.searchType);
  if (opts.activ != null) qs.set("activ", String(opts.activ));
  if (opts.q) qs.set("q", opts.q);
  if (opts.dataStart) qs.set("dataStart", opts.dataStart);
  if (opts.dataStop) qs.set("dataStop", opts.dataStop);
  const res = await fetch(`${BASE}/saved?${qs.toString()}`);
  return jsonOrThrow<RnpmCursorPage<RnpmAvizRecord>>(res);
}

export async function rnpmGetAvizDetail(id: number): Promise<RnpmAvizFull> {
  const res = await fetch(`${BASE}/saved/${id}`);
  return jsonOrThrow<RnpmAvizFull>(res);
}

export async function rnpmDeleteAviz(id: number): Promise<boolean> {
  const res = await fetch(`${BASE}/saved/${id}`, { method: "DELETE" });
  const data = await jsonOrThrow<{ deleted: boolean }>(res);
  return data.deleted;
}

export async function rnpmDeleteAllSaved(): Promise<number> {
  const res = await fetch(`${BASE}/saved/all`, { method: "DELETE" });
  const data = await jsonOrThrow<{ deleted: number }>(res);
  return data.deleted;
}

export async function rnpmGetStats(): Promise<RnpmStats> {
  const res = await fetch(`${BASE}/stats`);
  return jsonOrThrow<RnpmStats>(res);
}

export async function rnpmDeleteAvizeBatch(ids: number[]): Promise<number> {
  const res = await fetch(`${BASE}/saved/delete-batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  const data = await jsonOrThrow<{ deleted: number }>(res);
  return data.deleted;
}

export async function rnpmOpenDbFolder(): Promise<void> {
  const res = await fetch(`${BASE}/open-db-folder`, { method: "POST" });
  await jsonOrThrow<{ ok: true }>(res);
}

export async function rnpmExport(ids: number[]): Promise<{ items: RnpmAvizFull[] }> {
  const res = await fetch(`${BASE}/saved/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  return jsonOrThrow<{ items: RnpmAvizFull[] }>(res);
}

export async function rnpmCaptchaBalance(captchaKey: string, captchaProvider?: CaptchaProvider): Promise<number> {
  const res = await fetch(`${BASE}/captcha/balance`, {
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
  const res = await fetch(`${BASE}/bulk`, {
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

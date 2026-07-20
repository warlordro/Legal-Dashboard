import { afterEach, describe, expect, it, vi } from "vitest";

import { RnpmClient, type RnpmError } from "./rnpmClient.ts";

function jsonFetch(payload: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })) as unknown as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.RNPM_RUNTIME_VALIDATION_ENFORCED;
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.RNPM_RUNTIME_VALIDATION_DISABLED;
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.RNPM_TIMEOUT_MS;
});

describe("RnpmClient.search runtime validation", () => {
  it("default: payload care esueaza safeParse arunca schema_violation", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = new RnpmClient({
      requestDelayMs: 0,
      fetchImpl: jsonFetch({ documents: [], total: "invalid", pagesTotal: 0, pageSize: 50 }),
    });

    await expect(client.search("creante", { gcode: "captcha" }, 1)).rejects.toMatchObject({
      name: "RnpmError",
      status: 502,
      code: "schema_violation",
    } satisfies Partial<RnpmError>);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[rnpm] runtime validation failed"), expect.any(String));
  });

  it("RNPM_RUNTIME_VALIDATION_DISABLED=1 pastreaza fail-open operational temporar", async () => {
    process.env.RNPM_RUNTIME_VALIDATION_DISABLED = "1";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = new RnpmClient({
      requestDelayMs: 0,
      fetchImpl: jsonFetch({ documents: [], total: "invalid", pagesTotal: 0, pageSize: 50 }),
    });

    const result = await client.search("creante", { gcode: "captcha" }, 1);

    expect(result.total).toBe("invalid");
  });

  it("payload valid returneaza parsed.data fara warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const payload = {
      documents: [],
      total: 0,
      pagesTotal: 0,
      pageSize: 50,
      currentPage: 1,
      criteriu: null,
      eai: false,
      extra: "passthrough",
    };
    const client = new RnpmClient({
      requestDelayMs: 0,
      fetchImpl: jsonFetch(payload),
    });

    const result = await client.search("creante", { gcode: "captcha" }, 1);

    expect(result).toMatchObject(payload);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("RnpmClient timeout backstop (v2.37.1, review cluster 4)", () => {
  it("search fara raspuns upstream e abortat de RNPM_TIMEOUT_MS chiar fara semnal extern", async () => {
    process.env.RNPM_TIMEOUT_MS = "40";
    // fetch care nu rezolva niciodata, dar respecta AbortSignal — exact
    // comportamentul unui socket agatat.
    const hung = ((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new Error("aborted")));
      })) as unknown as typeof fetch;
    const client = new RnpmClient({ requestDelayMs: 0, fetchImpl: hung });

    await expect(client.search("creante", { gcode: "captcha" }, 1)).rejects.toMatchObject({
      name: "TimeoutError",
    });
  });

  it("semnalul extern ramane functional (abort manual inainte de timeout)", async () => {
    process.env.RNPM_TIMEOUT_MS = "60000";
    const hung = ((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new Error("aborted")));
      })) as unknown as typeof fetch;
    const client = new RnpmClient({ requestDelayMs: 0, fetchImpl: hung });

    const controller = new AbortController();
    const pending = client.search("creante", { gcode: "captcha" }, 1, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

function oversizedFetch(): typeof fetch {
  const huge = "x".repeat(40 * 1024 * 1024);
  return vi.fn(
    async () =>
      new Response(`{"pad":"${huge}"}`, {
        status: 200,
        headers: { "content-length": String(40 * 1024 * 1024 + 12) },
      })
  ) as unknown as typeof fetch;
}

describe("RnpmClient response cap (SEC-07)", () => {
  it("search rejects an oversized response with code response_too_large", async () => {
    const client = new RnpmClient({ requestDelayMs: 0, fetchImpl: oversizedFetch() });
    await expect(client.search("creante", { gcode: "captcha" }, 1)).rejects.toMatchObject({
      name: "RnpmError",
      code: "response_too_large",
    });
  });
  it("fetchPart rejects an oversized response with code response_too_large", async () => {
    const client = new RnpmClient({ requestDelayMs: 0, fetchImpl: oversizedFetch() });
    await expect(client.fetchPart("uuid", 1)).rejects.toMatchObject({ code: "response_too_large" });
  });
});

describe("RnpmClient abandoned-body drain (Codex MED)", () => {
  function instrumentedResponse(status: number, cancelledRef: { value: boolean }): Response {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x"));
      },
      cancel() {
        cancelledRef.value = true;
      },
    });
    return new Response(stream, { status });
  }

  it("fetchPart cancels the body on a 404 early return", async () => {
    const cancelled = { value: false };
    const fetchImpl = vi.fn(async () => instrumentedResponse(404, cancelled)) as unknown as typeof fetch;
    const client = new RnpmClient({ requestDelayMs: 0, fetchImpl });

    const result = await client.fetchPart("uuid", 1);

    expect(result).toBeNull();
    expect(cancelled.value).toBe(true);
  });

  it("fetchIstoric cancels the body on a 410 early return", async () => {
    const cancelled = { value: false };
    const fetchImpl = vi.fn(async () => instrumentedResponse(410, cancelled)) as unknown as typeof fetch;
    const client = new RnpmClient({ requestDelayMs: 0, fetchImpl });

    const result = await client.fetchIstoric("uuid");

    expect(result).toEqual([]);
    expect(cancelled.value).toBe(true);
  });
});

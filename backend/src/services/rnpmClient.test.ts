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

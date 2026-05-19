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

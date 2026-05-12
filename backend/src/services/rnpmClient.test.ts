import { afterEach, describe, expect, it, vi } from "vitest";

import { RnpmClient, type RnpmError } from "./rnpmClient.ts";

function jsonFetch(payload: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })) as unknown as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
  process.env.RNPM_RUNTIME_VALIDATION_ENFORCED = undefined;
});

describe("RnpmClient.search runtime validation", () => {
  it("Stage 1: payload care esueaza safeParse logheaza warning si returneaza raw", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = new RnpmClient({
      requestDelayMs: 0,
      fetchImpl: jsonFetch({ documents: [], total: "invalid", pagesTotal: 0, pageSize: 50 }),
    });

    const result = await client.search("creante", { gcode: "captcha" }, 1);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[rnpm] runtime validation failed"), expect.any(String));
    expect(result.total).toBe("invalid");
  });

  it("Stage 2 prep: RNPM_RUNTIME_VALIDATION_ENFORCED=1 arunca pe payload corupt", async () => {
    process.env.RNPM_RUNTIME_VALIDATION_ENFORCED = "1";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = new RnpmClient({
      requestDelayMs: 0,
      fetchImpl: jsonFetch({ documents: [], total: "invalid", pagesTotal: 0, pageSize: 50 }),
    });

    await expect(client.search("creante", { gcode: "captcha" }, 1)).rejects.toMatchObject({
      name: "RnpmError",
      status: 502,
      code: "schema_violation",
    } satisfies Partial<RnpmError>);
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

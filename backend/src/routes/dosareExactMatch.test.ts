import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../soap.ts", async (orig) => {
  const actual = await orig<typeof import("../soap.ts")>();
  return { ...actual, cautareDosare: vi.fn() };
});

import { cautareDosare } from "../soap.ts";
import { dosareRouter } from "./dosare.ts";

const mockedSearch = vi.mocked(cautareDosare);

function app() {
  const a = new Hono();
  a.route("/api/dosare", dosareRouter);
  return a;
}

// Minimal dosar: only `numar` is consulted by the exactMatch computation.
function dosar(numar: string) {
  return { numar } as unknown as Awaited<ReturnType<typeof cautareDosare>>[number];
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("GET /api/dosare — exactMatch (A5.6, PAT piesa A)", () => {
  it("flags exactMatch: true when a result docket number equals numarDosar", async () => {
    mockedSearch.mockResolvedValue([dosar("4821/3/2024"), dosar("999/1/2020")]);
    const res = await app().request("/api/dosare?numarDosar=4821/3/2024");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[]; total: number; exactMatch: boolean };
    expect(body.exactMatch).toBe(true);
    // extension, not replacement — existing fields preserved (fix PAT-012)
    expect(body.data).toHaveLength(2);
    expect(body.total).toBe(2);
  });

  it("flags exactMatch: false when no result matches the queried docket number", async () => {
    mockedSearch.mockResolvedValue([dosar("999/1/2020")]);
    const res = await app().request("/api/dosare?numarDosar=4821/3/2024");
    const body = (await res.json()) as { exactMatch: boolean };
    expect(body.exactMatch).toBe(false);
  });

  it("exactMatch is false on a name-only search (no numarDosar)", async () => {
    mockedSearch.mockResolvedValue([dosar("4821/3/2024")]);
    const res = await app().request("/api/dosare?numeParte=Popescu");
    const body = (await res.json()) as { exactMatch: boolean; data: unknown[] };
    expect(body.exactMatch).toBe(false);
    expect(body.data).toHaveLength(1);
  });
});

// Transport in flux pentru `POST /api/rnpm/search`, negociat prin `Accept`.
//
// Motivul: ruta e sincrona si nu emite niciun byte pana nu termina tot
// (captcha + interogare + detalii). Intermediarii taie tacerea — oauth2-proxy
// la `ResponseHeaderTimeout`, Cloudflare la propriul plafon — si utilizatorul
// primeste 502 desi cautarea era in regula. Vezi planul local
// docs/superpowers/plans/2026-08-01-rnpm-search-streaming.md.
//
// Contractul: clientii care NU cer `text/event-stream` primesc EXACT raspunsul
// de azi (taburi SPA deja deschise, consumatori API/PAT). Cei care il cer
// primesc acelasi payload, livrat ca eveniment `result`.
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestIdContext } from "../middleware/requestId.ts";
import { RnpmError } from "../services/rnpmClient.ts";
import { executeSearch } from "../services/rnpmSearchService.ts";
import { rnpmRouter } from "./rnpm.ts";

vi.mock("../services/rnpmSearchService.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/rnpmSearchService.ts")>();
  return { ...actual, executeSearch: vi.fn() };
});

function buildApp() {
  const app = new Hono();
  app.use("*", requestIdContext);
  app.route("/api/v1/rnpm", rnpmRouter);
  return app;
}

const OK_RESULT = {
  searchId: 7,
  documents: [],
  avizIds: [],
  detailsFailed: [],
  total: 3,
  pagesTotal: 1,
  pageSize: 25,
  currentPage: 1,
  criteriu: "c",
  gcode: "g",
  nextRnpmPage: null,
};

function searchBody() {
  return JSON.stringify({ type: "ipoteci", params: {}, captchaKey: "x".repeat(20) });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /rnpm/search — negociere transport", () => {
  it("fara Accept de flux raspunde JSON, ca azi", async () => {
    vi.mocked(executeSearch).mockResolvedValueOnce(OK_RESULT as unknown as Awaited<ReturnType<typeof executeSearch>>);

    const res = await buildApp().request("/api/v1/rnpm/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: searchBody(),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toMatchObject({ searchId: 7, total: 3 });
  });

  it("cu Accept: text/event-stream livreaza acelasi payload ca eveniment result", async () => {
    vi.mocked(executeSearch).mockResolvedValueOnce(OK_RESULT as unknown as Awaited<ReturnType<typeof executeSearch>>);

    const res = await buildApp().request("/api/v1/rnpm/search", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: searchBody(),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const text = await res.text();
    expect(text).toContain("event: result");

    const line = text.split("\n").find((l) => l.startsWith("data: "));
    expect(line).toBeDefined();
    const payload = JSON.parse((line as string).slice("data: ".length)) as Record<string, unknown>;
    expect(payload).toMatchObject({ searchId: 7, total: 3 });
    // Acelasi set de campuri ca pe calea JSON — fara scurgeri de campuri interne.
    expect(payload).not.toHaveProperty("captchasUsed");
  });
});

describe("POST /rnpm/search — erori tardive pe flux", () => {
  async function streamEvents(mockReject: unknown) {
    vi.mocked(executeSearch).mockRejectedValueOnce(mockReject);
    const res = await buildApp().request("/api/v1/rnpm/search", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: searchBody(),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    const dataLine = text.split("\n").find((l) => l.startsWith("data: "));
    return {
      text,
      payload: dataLine
        ? (JSON.parse(dataLine.slice("data: ".length)) as { status: number; body: Record<string, unknown> })
        : null,
    };
  }

  it("limit_exceeded ajunge cu status 400 si details pentru split", async () => {
    const { text, payload } = await streamEvents(
      new RnpmError("Prea multe rezultate", 400, undefined, "limit_exceeded", { total: 1501, limit: 1500 })
    );

    expect(text).toContain("event: error");
    expect(payload?.status).toBe(400);
    const err = payload?.body.error as { code: string; details: Record<string, unknown> };
    expect(err.code).toBe("LIMIT_EXCEEDED");
    expect(err.details).toMatchObject({ total: 1501, limit: 1500, splittable: { type: "ipoteci" } });
  });

  it("limita de stocare ajunge cu 429 si codul PUBLIC QUOTA_EXCEEDED", async () => {
    const storageErr = Object.assign(new Error("Spatiu plin"), {
      code: "RNPM_STORAGE_LIMIT",
      usedBytes: 900,
      limitBytes: 1000,
    });

    const { payload } = await streamEvents(storageErr);

    expect(payload?.status).toBe(429);
    const err = payload?.body.error as { code: string; details: Record<string, unknown> };
    expect(err.code).toBe("QUOTA_EXCEEDED");
    expect(err.details).toMatchObject({ feature: "rnpm.storage", usedBytes: 900, limitBytes: 1000 });
  });

  it("eroarea generica ajunge cu 500 si mesaj fara detalii interne", async () => {
    const { payload } = await streamEvents(new Error("cheie secreta in mesaj"));

    expect(payload?.status).toBe(500);
    const err = payload?.body.error as { code: string; message: string };
    expect(err.code).toBe("INTERNAL_ERROR");
    expect(err.message).not.toContain("cheie secreta");
  });

  it("la abort de client NU se livreaza eveniment terminal", async () => {
    const { text } = await streamEvents(new DOMException("Aborted", "AbortError"));

    expect(text).not.toContain("event: result");
    expect(text).not.toContain("event: error");
  });
});

// Caracterizare: fixeaza FORMA raspunsului de succes al `POST /api/rnpm/search`
// inainte de trecerea rutei pe transport in flux (plan
// docs/superpowers/plans/2026-08-01-rnpm-search-streaming.md).
//
// Ruta construieste corpul camp cu camp, nu prin spread peste rezultatul
// serviciului — `ExecuteSearchResult` are campuri care NU se expun (ex.
// `captchasUsed`). Un refactor care ar trece pe spread ar scurge campuri noi
// fara ca vreun test sa observe. Asertia pe setul EXACT de chei prinde asta in
// ambele sensuri: si camp scurs, si camp disparut.
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestIdContext } from "../middleware/requestId.ts";
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

afterEach(() => {
  vi.clearAllMocks();
});

describe("caracterizare: forma raspunsului de succes /rnpm/search", () => {
  it("expune exact campurile publice, fara cele interne ale serviciului", async () => {
    vi.mocked(executeSearch).mockResolvedValueOnce({
      searchId: 42,
      documents: [],
      avizIds: [],
      detailsFailed: [],
      total: 7,
      pagesTotal: 1,
      pageSize: 25,
      currentPage: 1,
      criteriu: "criteriu-test",
      gcode: "gcode-test",
      nextRnpmPage: null,
      // Campuri interne care NU trebuie sa ajunga la client:
      captchasUsed: 3,
    } as unknown as Awaited<ReturnType<typeof executeSearch>>);

    const res = await buildApp().request("/api/v1/rnpm/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "ipoteci", params: {}, captchaKey: "x".repeat(20) }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(Object.keys(body).sort()).toEqual(
      [
        "avizIds",
        "criteriu",
        "currentPage",
        "detailsFailed",
        "documents",
        "gcode",
        "nextRnpmPage",
        "pageSize",
        "pagesTotal",
        "searchId",
        "total",
      ].sort()
    );
    expect(body).not.toHaveProperty("captchasUsed");
    expect(body.searchId).toBe(42);
    expect(body.total).toBe(7);
  });
});

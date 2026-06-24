import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { requestIdContext } from "../middleware/requestId.ts";
import { termeneExportRouter, termeneRouter } from "./termene.ts";

type EnvelopeErrorBody = {
  data: null;
  error: { code: string; message: string };
  requestId: string;
};

function buildApp() {
  const app = new Hono();
  app.use("*", requestIdContext);
  app.route("/api/termene", termeneRouter);
  app.route("/api/v1/termene", termeneExportRouter);
  return app;
}

async function expectEnvelope(res: Response, code: string) {
  const body = (await res.json()) as EnvelopeErrorBody;
  expect(body).toMatchObject({
    data: null,
    error: { code, message: expect.any(String) },
    requestId: expect.any(String),
  });
  expect(body.requestId.length).toBeGreaterThan(0);
}

describe("termene routes - envelope shape", () => {
  it("POST /api/v1/termene/export.xlsx peste body limit returneaza PAYLOAD_TOO_LARGE 413", async () => {
    const res = await buildApp().request("/api/v1/termene/export.xlsx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: "x".repeat(26 * 1024 * 1024) }),
    });
    expect(res.status).toBe(413);
    await expectEnvelope(res, "PAYLOAD_TOO_LARGE");
  });

  it("POST /api/v1/termene/export.xlsx cu lista goala returneaza INVALID_PARAMS 400", async () => {
    const res = await buildApp().request("/api/v1/termene/export.xlsx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ termene: [] }),
    });
    expect(res.status).toBe(400);
    await expectEnvelope(res, "INVALID_PARAMS");
  });

  it("GET /api/termene fara filtre returneaza INVALID_PARAMS 400", async () => {
    const res = await buildApp().request("/api/termene");
    expect(res.status).toBe(400);
    await expectEnvelope(res, "INVALID_PARAMS");
  });

  it("POST /api/termene/load-more fara filtre returneaza INVALID_PARAMS 400", async () => {
    const res = await buildApp().request("/api/termene/load-more", { method: "POST" });
    expect(res.status).toBe(400);
    await expectEnvelope(res, "INVALID_PARAMS");
  });
});

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { requestIdContext } from "../middleware/requestId.ts";
import { aiRouter } from "./ai.ts";

type EnvelopeErrorBody = {
  data: null;
  error: { code: string; message: string };
  requestId: string;
};

function buildApp() {
  const app = new Hono();
  app.use("*", requestIdContext);
  app.route("/api/ai", aiRouter);
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

describe("AI routes - envelope shape", () => {
  it("POST /api/ai/analyze fara body returneaza INVALID_JSON 400 envelope", async () => {
    const res = await buildApp().request("/api/ai/analyze", { method: "POST" });
    expect(res.status).toBe(400);
    await expectEnvelope(res, "INVALID_JSON");
  });

  it("POST /api/ai/analyze cu model necunoscut returneaza UNKNOWN_MODEL 400", async () => {
    const res = await buildApp().request("/api/ai/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "model-care-nu-exista",
        dosar: { numar: "123/2024", institutie: "JUDECATORIA BUCURESTI" },
        apiKeys: { anthropic: "sk-test" },
      }),
    });
    expect(res.status).toBe(400);
    await expectEnvelope(res, "UNKNOWN_MODEL");
  });

  it("POST /api/ai/analyze cu model valid dar fara apiKeys returneaza MISSING_API_KEY", async () => {
    const res = await buildApp().request("/api/ai/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet",
        dosar: { numar: "123/2024", institutie: "JUDECATORIA BUCURESTI" },
        apiKeys: {},
      }),
    });
    expect(res.status).toBe(400);
    await expectEnvelope(res, "MISSING_API_KEY");
  });

  it("POST /api/ai/analyze-multi cu mai putin de 2 modele analist returneaza INVALID_PARAMS", async () => {
    const res = await buildApp().request("/api/ai/analyze-multi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        analysts: ["claude-sonnet"],
        judge: "claude-opus",
        dosar: { numar: "123/2024", institutie: "JUDECATORIA BUCURESTI" },
        apiKeys: { anthropic: "sk-test" },
      }),
    });
    expect(res.status).toBe(400);
    await expectEnvelope(res, "INVALID_PARAMS");
  });
});

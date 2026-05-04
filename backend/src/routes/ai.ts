import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import {
  AI_MODELS,
  AI_MULTI_TIMEOUT,
  AI_TIMEOUT,
  JUDGE_MODELS,
  MAX_AI_BODY_SIZE,
  buildJudgePrompt,
  buildPrompt,
  callAnthropic,
  callGoogle,
  callModel,
  callOpenAI,
  getApiKey,
  validateAiBody,
} from "../services/ai.ts";
import { getOwnerId } from "../middleware/owner.ts";
import { getRequestId } from "../middleware/requestId.ts";
import type { AiUsageTrackingContext } from "../services/aiUsage.ts";
import { getAuthMode } from "../auth/config.ts";

export const aiRouter = new Hono();

// In AUTH_MODE=web, BYOK via request body is refused: secrets transiting the
// server contradict the server-side config direction (decizia #4 in roadmap —
// AI keys centralizate in `.env` server). Operators must set ANTHROPIC_API_KEY
// / OPENAI_API_KEY / GOOGLE_AI_KEY in env. Desktop loopback keeps BYOK via
// safeStorage IPC. Returns 501 (not 403) because the body shape is valid but
// not implemented in this auth mode.
function rejectApiKeysFromBodyInWebMode(body: { apiKeys?: unknown }): Response | null {
  if (getAuthMode() !== "web") return null;
  if (!body.apiKeys || typeof body.apiKeys !== "object") return null;
  const hasSetKey = Object.values(body.apiKeys as Record<string, unknown>).some(
    (v) => typeof v === "string" && v.length > 0,
  );
  if (!hasSetKey) return null;
  return Response.json(
    {
      error:
        "Cheile AI nu pot fi trimise in body in modul web. Configurati ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_AI_KEY in env-ul serverului.",
    },
    { status: 501 },
  );
}

// Shared body parser for AI POST endpoints. Enforces MAX_AI_BODY_SIZE on both
// the Content-Length header and the actual body, then parses JSON. Returns a
// discriminated result so the route can map the error to its own response
// shape without losing the early-return ergonomics.
type ParsedAiBody =
  | { kind: "ok"; body: unknown }
  | { kind: "error"; status: 400 | 413; message: string };

async function parseAiBody(c: Context): Promise<ParsedAiBody> {
  const contentLength = parseInt(c.req.header("content-length") || "0", 10);
  if (contentLength > MAX_AI_BODY_SIZE) {
    return { kind: "error", status: 413, message: "Cererea depaseste dimensiunea maxima permisa." };
  }
  const rawBody = await c.req.text();
  if (rawBody.length > MAX_AI_BODY_SIZE) {
    return { kind: "error", status: 413, message: "Cererea depaseste dimensiunea maxima permisa." };
  }
  try {
    return { kind: "ok", body: JSON.parse(rawBody) };
  } catch {
    return { kind: "error", status: 400, message: "JSON invalid." };
  }
}

// AI Analysis endpoint
aiRouter.post("/analyze", async (c) => {
  try {
    const parsed = await parseAiBody(c);
    if (parsed.kind === "error") return c.json({ error: parsed.message }, parsed.status);
    // NOTE: typed `any` here is validated below by validateAiBody before any field access.
    const body: any = parsed.body;

    const webGate = rejectApiKeysFromBodyInWebMode(body);
    if (webGate) return webGate;

    // Schema validation
    const validationError = validateAiBody(body);
    if (validationError) {
      return c.json({ error: validationError }, 400);
    }

    const { dosar, model: modelKey, apiKeys } = body;

    const selectedModel = AI_MODELS[modelKey || "claude-sonnet"];
    if (!selectedModel) {
      return c.json({ error: "Model necunoscut." }, 400);
    }

    // Get API key for the provider (env preferred, body fallback — see getApiKey)
    const keys = apiKeys || {};
    const apiKey = getApiKey(selectedModel.provider, keys);

    if (!apiKey) {
      return c.json({ error: "NO_API_KEY" }, 400);
    }

    const prompt = buildPrompt(dosar);
    const tracking: AiUsageTrackingContext = {
      ownerId: getOwnerId(c),
      requestId: getRequestId(c),
      feature: "dosar_summary",
    };
    const dispatch: Record<string, (key: string, modelId: string, prompt: string, timeout: number, tracking?: AiUsageTrackingContext) => Promise<string>> = {
      anthropic: callAnthropic,
      openai: callOpenAI,
      google: callGoogle,
    };
    const providerFn = dispatch[selectedModel.provider];
    const text = providerFn ? await providerFn(apiKey, selectedModel.modelId, prompt, AI_TIMEOUT, tracking) : "";

    return c.json({ analysis: text });
  } catch (err: unknown) {
    // SECURITY: Log error server-side but never expose internal details to client
    console.error("Eroare AI:", err instanceof Error ? err.message : err);
    return c.json({ error: "Eroare la analiza AI. Verificati cheia API si incercati din nou." }, 500);
  }
});

// Multi-Agent AI Analysis endpoint
aiRouter.post("/analyze-multi", async (c) => {
  try {
    const parsed = await parseAiBody(c);
    if (parsed.kind === "error") return c.json({ error: parsed.message }, parsed.status);
    // NOTE: typed `any` here is validated below by validateAiBody and per-field checks.
    const body: any = parsed.body;

    const webGate = rejectApiKeysFromBodyInWebMode(body);
    if (webGate) return webGate;

    // Validate structure (reuse dosar validation from single-agent endpoint)
    if (!body || typeof body !== "object") return c.json({ error: "Body invalid." }, 400);
    if (!body.dosar || typeof body.dosar !== "object") return c.json({ error: "Lipsesc datele dosarului." }, 400);

    // SECURITY: Validate dosar fields (same validation as single-agent endpoint)
    const dosarValidationError = validateAiBody(body);
    if (dosarValidationError) {
      return c.json({ error: dosarValidationError }, 400);
    }

    if (!Array.isArray(body.analysts) || body.analysts.length !== 2) return c.json({ error: "Trebuie exact 2 modele analist." }, 400);
    for (const m of body.analysts) {
      if (typeof m !== "string" || !(m in AI_MODELS)) return c.json({ error: "Model analist necunoscut." }, 400);
    }
    if (!body.judge || typeof body.judge !== "string") return c.json({ error: "Lipseste modelul judecator." }, 400);
    if (!JUDGE_MODELS.includes(body.judge)) return c.json({ error: "Model judecator nepermis. Doar Claude Opus 4.6, GPT-5.4 si Gemini 3.1 Pro." }, 400);
    if (!(body.judge in AI_MODELS)) return c.json({ error: "Model judecator necunoscut." }, 400);

    // Validate apiKeys
    const keys = body.apiKeys || {};
    if (body.apiKeys && typeof body.apiKeys !== "object") return c.json({ error: "Format apiKeys invalid." }, 400);
    if (body.apiKeys && typeof body.apiKeys === "object") {
      for (const [k, v] of Object.entries(body.apiKeys as Record<string, unknown>)) {
        if (v !== undefined && v !== null && v !== "") {
          if (typeof v !== "string") return c.json({ error: `Cheie API invalida: ${k}` }, 400);
          if ((v as string).length > 256) return c.json({ error: `Cheie API prea lunga: ${k}` }, 400);
        }
      }
    }

    const { dosar, analysts, judge } = body;
    const prompt = buildPrompt(dosar);
    const trackingBase = {
      ownerId: getOwnerId(c),
      requestId: getRequestId(c),
    };

    // Stream phase events so the UI can show progress (analysts take 30-60s each,
    // judge 60-120s — without streaming the user sees a blank spinner for up to 4 min).
    return streamSSE(c, async (stream) => {
      // Shared cancellation for the analyst pair: when one analyst rejects,
      // Promise.all rethrows immediately and the catch below aborts the
      // controller, cancelling the sibling's in-flight HTTP request instead
      // of letting it run to its full AI_MULTI_TIMEOUT (180s) and burn tokens.
      const analystsAbort = new AbortController();
      try {
        // Phase 1+2: analysts in parallel, emit per-analyst completion as soon as it lands.
        const p1 = callModel(analysts[0], prompt, keys, AI_MULTI_TIMEOUT, {
          ...trackingBase,
          feature: "dosar_multi_analyst",
        }, analystsAbort.signal).then(async (text) => {
          await stream.writeSSE({ event: "analyst_done", data: JSON.stringify({ which: 1 }) });
          return text;
        });
        const p2 = callModel(analysts[1], prompt, keys, AI_MULTI_TIMEOUT, {
          ...trackingBase,
          feature: "dosar_multi_analyst",
        }, analystsAbort.signal).then(async (text) => {
          await stream.writeSSE({ event: "analyst_done", data: JSON.stringify({ which: 2 }) });
          return text;
        });
        let analysisA: string;
        let analysisB: string;
        try {
          [analysisA, analysisB] = await Promise.all([p1, p2]);
        } catch (err) {
          analystsAbort.abort();
          throw err;
        }

        // Phase 3: judge reconciliation.
        await stream.writeSSE({ event: "judge_started", data: "{}" });
        const judgePrompt = buildJudgePrompt(dosar, analysisA, analysts[0], analysisB, analysts[1]);
        const finalAnalysis = await callModel(judge, judgePrompt, keys, AI_MULTI_TIMEOUT, {
          ...trackingBase,
          feature: "dosar_multi_judge",
        });

        await stream.writeSSE({
          event: "done",
          data: JSON.stringify({
            result: {
              analyses: {
                analyst1: { model: analysts[0], text: analysisA },
                analyst2: { model: analysts[1], text: analysisB },
              },
              judge: { model: judge, text: finalAnalysis },
              final: finalAnalysis,
            },
          }),
        });
      } catch (err: unknown) {
        console.error("Eroare AI Multi:", err instanceof Error ? err.message : err);
        const msg = err instanceof Error ? err.message : "";
        let errorText = "Eroare la analiza AI avansata. Verificati cheile API si incercati din nou.";
        if (msg.startsWith("NO_API_KEY:")) {
          const provider = msg.split(":")[1];
          errorText = `Lipseste cheia API pentru ${provider}. Configureaza din Setari AI.`;
        }
        await stream.writeSSE({ event: "error", data: JSON.stringify({ error: errorText }) });
      }
    });
  } catch (err: unknown) {
    console.error("Eroare AI Multi:", err instanceof Error ? err.message : err);
    return c.json({ error: "Eroare la analiza AI avansata. Verificati cheile API si incercati din nou." }, 500);
  }
});

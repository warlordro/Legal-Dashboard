import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import {
  AI_MODELS,
  AI_MULTI_TIMEOUT,
  AI_TIMEOUT,
  JUDGE_MODELS,
  MAX_AI_BODY_SIZE,
  buildJudgePrompt,
  buildPrompt,
  callModel,
  getApiKey,
  type AiRouting,
  validateAiBody,
} from "../services/ai.ts";
import { getSettings, upsertSettings } from "../db/ownerAiSettingsRepository.ts";
import { getOwnerId } from "../middleware/owner.ts";
import { getRequestId } from "../middleware/requestId.ts";
import type { AiUsageTrackingContext } from "../services/aiUsage.ts";
import { getAuthMode } from "../auth/config.ts";
import { ErrorCodes, fail } from "../util/envelope.ts";

export const aiRouter = new Hono();

const aiSettingsSchema = z.object({
  mode: z.enum(["native", "openrouter"]),
  openrouter_stack: z.enum(["western", "chinese"]),
});

// In AUTH_MODE=web, BYOK via request body is refused: secrets transiting the
// server contradict the server-side config direction (decizia #4 in roadmap —
// AI keys centralizate in `.env` server). Operators must set ANTHROPIC_API_KEY
// / OPENAI_API_KEY / GOOGLE_AI_KEY / OPENROUTER_API_KEY in env. Desktop loopback keeps BYOK via
// safeStorage IPC. Returns 501 (not 403) because the body shape is valid but
// not implemented in this auth mode.
function rejectApiKeysFromBodyInWebMode(c: Context, body: { apiKeys?: unknown }): Response | null {
  if (getAuthMode() !== "web") return null;
  if (!body.apiKeys || typeof body.apiKeys !== "object") return null;
  const hasSetKey = Object.values(body.apiKeys as Record<string, unknown>).some(
    (v) => typeof v === "string" && v.length > 0
  );
  if (!hasSetKey) return null;
  return c.json(
    fail(
      ErrorCodes.WEB_MODE_NOT_IMPLEMENTED,
      "Cheile AI nu pot fi trimise in body in modul web. Configurati ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_AI_KEY / OPENROUTER_API_KEY in env-ul serverului.",
      c
    ),
    501
  );
}

// Shared body parser for AI POST endpoints. Enforces MAX_AI_BODY_SIZE on both
// the Content-Length header and the actual body, then parses JSON. Returns a
// discriminated result so the route can map the error to its own response
// shape without losing the early-return ergonomics.
type ParsedAiBody = { kind: "ok"; body: unknown } | { kind: "error"; status: 400 | 413; message: string };

async function parseAiBody(c: Context): Promise<ParsedAiBody> {
  const contentLength = Number.parseInt(c.req.header("content-length") || "0", 10);
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

function parsedBodyError(c: Context, parsed: Extract<ParsedAiBody, { kind: "error" }>) {
  const code = parsed.status === 413 ? ErrorCodes.PAYLOAD_TOO_LARGE : ErrorCodes.INVALID_JSON;
  return c.json(fail(code, parsed.message, c), parsed.status);
}

function invalidParams(c: Context, message: string) {
  return c.json(fail(ErrorCodes.INVALID_PARAMS, message, c), 400);
}

function modelError(c: Context, message: string) {
  return c.json(fail(ErrorCodes.UNKNOWN_MODEL, message, c), 400);
}

function aiFailure(c: Context, message: string) {
  return c.json(fail(ErrorCodes.AI_ANALYSIS_FAILED, message, c), 500);
}

function missingApiKey(c: Context, provider: string) {
  if (getAuthMode() === "web") {
    return c.json(
      fail(
        ErrorCodes.WEB_MODE_NOT_IMPLEMENTED,
        `AI indisponibil in modul web: configurati cheia ${provider.toUpperCase()} in env-ul serverului.`,
        c
      ),
      501
    );
  }
  return c.json(fail(ErrorCodes.MISSING_API_KEY, "NO_API_KEY", c), 400);
}

function getRouting(c: Context): AiRouting {
  const settings = getSettings(getOwnerId(c));
  return { mode: settings.mode, stack: settings.openrouter_stack };
}

function routesViaOpenRouter(modelKey: string, apiKeys: Record<string, string>, routing: AiRouting): boolean {
  return (
    routing.mode === "openrouter" ||
    Boolean(process.env.OPENROUTER_API_KEY) ||
    Boolean(apiKeys.openrouter?.startsWith("sk-or-")) ||
    AI_MODELS[modelKey]?.provider === "openrouter"
  );
}

function assertStackPurity(modelKeys: string[], stack: AiRouting["stack"]): string | null {
  return modelKeys.find((key) => AI_MODELS[key]?.stack !== stack) ?? null;
}

aiRouter.get("/settings", (c) => {
  const settings = getSettings(getOwnerId(c));
  return c.json({
    mode: settings.mode,
    openrouter_stack: settings.openrouter_stack,
  });
});

aiRouter.put("/settings", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(fail(ErrorCodes.INVALID_JSON, "JSON invalid.", c), 400);
  }

  const parsed = aiSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(fail(ErrorCodes.INVALID_PARAMS, "Setari AI invalide.", c, parsed.error.issues), 400);
  }

  const settings = upsertSettings(getOwnerId(c), parsed.data);
  return c.json({
    mode: settings.mode,
    openrouter_stack: settings.openrouter_stack,
  });
});

// AI Analysis endpoint
aiRouter.post("/analyze", async (c) => {
  try {
    const parsed = await parseAiBody(c);
    if (parsed.kind === "error") return parsedBodyError(c, parsed);
    const body = parsed.body as Record<string, unknown>;

    const webGate = rejectApiKeysFromBodyInWebMode(c, body);
    if (webGate) return webGate;

    // Schema validation
    const validationError = validateAiBody(body);
    if (validationError) {
      if (validationError === "Model necunoscut.") return modelError(c, validationError);
      return invalidParams(c, validationError);
    }

    const dosar = body.dosar as Record<string, unknown>;
    const modelKey = typeof body.model === "string" ? body.model : undefined;
    const apiKeys = body.apiKeys && typeof body.apiKeys === "object" ? (body.apiKeys as Record<string, string>) : {};

    const selectedModel = AI_MODELS[modelKey || "claude-sonnet"];
    if (!selectedModel) {
      return modelError(c, "Model necunoscut.");
    }

    // Get API key for the provider (env preferred, body fallback — see getApiKey)
    const keys = apiKeys;
    const routing = getRouting(c);
    if (routing.mode === "openrouter" && selectedModel.stack !== routing.stack) {
      return modelError(c, `Modelul ${modelKey || "claude-sonnet"} nu apartine stack-ului ${routing.stack}.`);
    }

    const requiredProvider = routesViaOpenRouter(modelKey || "claude-sonnet", keys, routing)
      ? "openrouter"
      : selectedModel.provider;
    const apiKey = getApiKey(requiredProvider, keys);

    if (!apiKey) {
      return missingApiKey(c, requiredProvider);
    }

    const prompt = buildPrompt(dosar);
    const tracking: AiUsageTrackingContext = {
      ownerId: getOwnerId(c),
      requestId: getRequestId(c),
      feature: "dosar_summary",
    };
    const text = await callModel(modelKey || "claude-sonnet", prompt, keys, AI_TIMEOUT, tracking, undefined, routing);

    return c.json({ analysis: text });
  } catch (err: unknown) {
    // SECURITY: Log error server-side but never expose internal details to client
    console.error("Eroare AI:", err instanceof Error ? err.message : err);
    return aiFailure(c, "Eroare la analiza AI. Verificati cheia API si incercati din nou.");
  }
});

// Multi-Agent AI Analysis endpoint
aiRouter.post("/analyze-multi", async (c) => {
  try {
    const parsed = await parseAiBody(c);
    if (parsed.kind === "error") return parsedBodyError(c, parsed);
    const body = parsed.body as Record<string, unknown>;

    const webGate = rejectApiKeysFromBodyInWebMode(c, body);
    if (webGate) return webGate;

    // Validate structure (reuse dosar validation from single-agent endpoint)
    if (!body || typeof body !== "object") return invalidParams(c, "Body invalid.");
    if (!body.dosar || typeof body.dosar !== "object") return invalidParams(c, "Lipsesc datele dosarului.");

    // SECURITY: Validate dosar fields (same validation as single-agent endpoint)
    const dosarValidationError = validateAiBody(body);
    if (dosarValidationError) {
      if (dosarValidationError === "Model necunoscut.") return modelError(c, dosarValidationError);
      return invalidParams(c, dosarValidationError);
    }

    if (!Array.isArray(body.analysts) || body.analysts.length !== 2)
      return invalidParams(c, "Trebuie exact 2 modele analist.");
    for (const m of body.analysts) {
      if (typeof m !== "string" || !(m in AI_MODELS)) return modelError(c, "Model analist necunoscut.");
    }
    if (!body.judge || typeof body.judge !== "string") return invalidParams(c, "Lipseste modelul judecator.");
    if (!JUDGE_MODELS.includes(body.judge))
      return invalidParams(
        c,
        "Model judecator nepermis. Doar Claude Opus 4.6, GPT-5.4, Gemini 3.1 Pro, GLM 5.1, Kimi K2.6 si Qwen 3.6 Max."
      );
    if (!(body.judge in AI_MODELS)) return modelError(c, "Model judecator necunoscut.");

    // Validate apiKeys
    const keys = body.apiKeys && typeof body.apiKeys === "object" ? (body.apiKeys as Record<string, string>) : {};
    if (body.apiKeys && typeof body.apiKeys !== "object") return invalidParams(c, "Format apiKeys invalid.");
    if (body.apiKeys && typeof body.apiKeys === "object") {
      for (const [k, v] of Object.entries(body.apiKeys as Record<string, unknown>)) {
        if (v !== undefined && v !== null && v !== "") {
          if (typeof v !== "string") return invalidParams(c, `Cheie API invalida: ${k}`);
          if ((v as string).length > 256) return invalidParams(c, `Cheie API prea lunga: ${k}`);
        }
      }
    }

    const dosar = body.dosar as Record<string, unknown>;
    const analysts = body.analysts as string[];
    const judge = body.judge as string;
    const routing = getRouting(c);
    if (routing.mode === "openrouter") {
      const wrongStackModel = assertStackPurity([...analysts, judge], routing.stack);
      if (wrongStackModel) {
        return c.json(
          fail("STACK_MIX_FORBIDDEN", `Model ${wrongStackModel} nu apartine stack-ului ${routing.stack}`, c),
          400
        );
      }
    }
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
        const p1 = callModel(
          analysts[0],
          prompt,
          keys,
          AI_MULTI_TIMEOUT,
          {
            ...trackingBase,
            feature: "dosar_multi_analyst",
          },
          analystsAbort.signal,
          routing
        ).then(async (text) => {
          await stream.writeSSE({ event: "analyst_done", data: JSON.stringify({ which: 1 }) });
          return text;
        });
        const p2 = callModel(
          analysts[1],
          prompt,
          keys,
          AI_MULTI_TIMEOUT,
          {
            ...trackingBase,
            feature: "dosar_multi_analyst",
          },
          analystsAbort.signal,
          routing
        ).then(async (text) => {
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
        const finalAnalysis = await callModel(
          judge,
          judgePrompt,
          keys,
          AI_MULTI_TIMEOUT,
          {
            ...trackingBase,
            feature: "dosar_multi_judge",
          },
          undefined,
          routing
        );

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
    return aiFailure(c, "Eroare la analiza AI avansata. Verificati cheile API si incercati din nou.");
  }
});

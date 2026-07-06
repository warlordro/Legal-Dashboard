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
  shouldRouteViaOpenRouter,
  type AiRouting,
  validateAiBody,
} from "../services/ai.ts";
import { getSettings, upsertSettings, type AiProviderMode } from "../db/ownerAiSettingsRepository.ts";
import { getDecryptedKey } from "../db/tenantKeysRepository.ts";
import { releaseAiUsageReservation } from "../db/aiUsageRepository.ts";
import { getOwnerId } from "../middleware/owner.ts";
import { quotaGuard, reserveQuotaBudget } from "../middleware/quotaGuard.ts";
import { getRequestId } from "../middleware/requestId.ts";
import type { AiUsageTrackingContext } from "../services/aiUsage.ts";
import { getAuthMode } from "../auth/config.ts";
import { ErrorCodes, fail } from "../util/envelope.ts";

export const aiRouter = new Hono();

const aiSettingsSchema = z.object({
  mode: z.enum(["native", "openrouter"]),
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
        ErrorCodes.MISSING_API_KEY,
        `Cheia AI pentru ${provider} nu e configurata. Contacteaza adminul pentru a o seta in /admin/keys.`,
        c
      ),
      400
    );
  }
  return c.json(fail(ErrorCodes.MISSING_API_KEY, "NO_API_KEY", c), 400);
}

// v2.41.0 (P3): rutare AI implicita. Setarea explicita a ownerului (rand in
// owner_ai_settings — updated_at > 0) are prioritate. Fara alegere explicita,
// in web mode auto-detectam pe PREZENTA cheii OpenRouter a tenantului (nu pe
// absenta cheilor native — decizie de spec: motivatia e tenantul care a
// configurat doar OpenRouter si ar primi MISSING_API_KEY pe default-ul
// "native"; un tenant cu ambele tipuri de chei isi alege explicit modul din
// UI). Try/catch: o cheie tenant nedecriptabila (secret rotit/corupt) nu
// darama ruta — cade pe "native".
function resolveEffectiveAiMode(ownerId: string): AiProviderMode {
  const settings = getSettings(ownerId);
  if (settings.updated_at > 0) return settings.mode;
  if (getAuthMode() === "web") {
    try {
      if (getDecryptedKey("openrouter")) return "openrouter";
    } catch {
      /* cheia tenant indisponibila -> fallback native */
    }
  }
  return "native";
}

function getRouting(c: Context): AiRouting {
  return { mode: resolveEffectiveAiMode(getOwnerId(c)) };
}

aiRouter.get("/settings", (c) => {
  // Intoarce modul EFECTIV (explicit sau auto-detectat) — UI-ul de rutare si
  // disponibilitatea modelelor din frontend se aliniaza la ce va face serverul.
  return c.json({ mode: resolveEffectiveAiMode(getOwnerId(c)) });
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

  const settings = upsertSettings(getOwnerId(c), { mode: parsed.data.mode });
  return c.json({ mode: settings.mode });
});

// AI Analysis endpoint
aiRouter.post("/analyze", quotaGuard("ai.single"), async (c) => {
  // FIX #5 (v2.33.0 follow-up): rezervarea pentru ai.single trebuie eliberata
  // explicit cand callModel nu confirma usage-ul. Inainte, orice throw intre
  // reserveQuotaBudget si callModel (buildPrompt sync, fetch error, abort
  // anticipat) lasa pending-ul in DB pana cand purgeExpiredReservations rula
  // (~5min), umflandu-i artificial bugetul user-ului. confirmAiUsageReservation
  // este apelat in interiorul callModel pe succes -> in branch-ul de succes
  // reservationToRelease devine null si finally-ul nu mai face nimic.
  let reservationToRelease: number | null = null;
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
    const requiredProvider = shouldRouteViaOpenRouter(keys, routing) ? "openrouter" : selectedModel.provider;
    const apiKey = getApiKey(requiredProvider, keys);

    if (!apiKey) {
      return missingApiKey(c, requiredProvider);
    }

    const quotaReservation = reserveQuotaBudget(c, "ai.single", requiredProvider);
    if (!quotaReservation.ok) return quotaReservation.response;
    reservationToRelease = quotaReservation.reservationId;

    const prompt = buildPrompt(dosar);
    const tracking: AiUsageTrackingContext = {
      ownerId: getOwnerId(c),
      requestId: getRequestId(c),
      feature: "dosar_summary",
      reservationId: quotaReservation.reservationId,
    };
    // F6: paseaza signal-ul HTTP request-ului catre SDK-ul AI ca, daca clientul
    // inchide tabul, sa nu mai consumam tokens degeaba. callModel deja respecta
    // signal-ul prin Anthropic/OpenAI SDK + abort propagation.
    const text = await callModel(
      modelKey || "claude-sonnet",
      prompt,
      keys,
      AI_TIMEOUT,
      tracking,
      c.req.raw.signal,
      routing
    );

    // Succes: callModel a apelat deja confirmAiUsageReservation in interior.
    reservationToRelease = null;
    return c.json({ analysis: text });
  } catch (err: unknown) {
    // SECURITY: Log error server-side but never expose internal details to client
    console.error("Eroare AI:", err instanceof Error ? err.message : err);
    return aiFailure(c, "Eroare la analiza AI. Verificati cheia API si incercati din nou.");
  } finally {
    if (reservationToRelease !== null) {
      const reservationId = reservationToRelease;
      queueMicrotask(() => {
        try {
          releaseAiUsageReservation(reservationId);
        } catch (releaseErr) {
          console.warn(
            JSON.stringify({
              action: "quota.reservation_release_failed",
              reservationId,
              error: releaseErr instanceof Error ? releaseErr.message : String(releaseErr),
              ts: new Date().toISOString(),
            })
          );
        }
      });
    }
  }
});

// Multi-Agent AI Analysis endpoint
aiRouter.post("/analyze-multi", quotaGuard("ai.multi"), async (c) => {
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
      return invalidParams(c, "Model judecator nepermis. Doar Claude Opus 4.8, GPT-5.4 si Gemini 3.1 Pro.");
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
    const reserveProvider = routing.mode === "openrouter" ? "openrouter" : AI_MODELS[judge]?.provider;
    if (!reserveProvider) return modelError(c, "Model judecator necunoscut.");
    const quotaReservation = reserveQuotaBudget(c, "ai.multi", reserveProvider);
    if (!quotaReservation.ok) return quotaReservation.response;
    const prompt = buildPrompt(dosar);
    const trackingBase = {
      ownerId: getOwnerId(c),
      requestId: getRequestId(c),
    };

    // Stream phase events so the UI can show progress (analysts take 30-60s each,
    // judge 60-120s — without streaming the user sees a blank spinner for up to 4 min).
    return streamSSE(c, async (stream) => {
      let releaseReservationAfterStream = quotaReservation.reservationId;
      // Shared cancellation for the analyst pair: when one analyst rejects,
      // Promise.all rethrows immediately and the catch below aborts the
      // controller, cancelling the sibling's in-flight HTTP request instead
      // of letting it run to its full AI_MULTI_TIMEOUT (180s) and burn tokens.
      const analystsAbort = new AbortController();
      const judgeAbort = new AbortController();
      // F6: daca clientul inchide tabul (request.signal.aborted) sau SSE-ul
      // (stream.onAbort fires when the connection closes), abortam toate
      // call-urile AI ramase ca sa nu mai consumam tokens.
      const clientSignal = c.req.raw.signal;
      const cancelAll = () => {
        analystsAbort.abort();
        judgeAbort.abort();
      };
      if (clientSignal.aborted) {
        cancelAll();
      } else {
        clientSignal.addEventListener("abort", cancelAll, { once: true });
      }
      stream.onAbort(() => {
        cancelAll();
      });
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
          judgeAbort.signal,
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
      } finally {
        if (releaseReservationAfterStream != null) {
          const reservationId = releaseReservationAfterStream;
          releaseReservationAfterStream = null;
          queueMicrotask(() => {
            try {
              releaseAiUsageReservation(reservationId);
            } catch (err) {
              console.warn(
                JSON.stringify({
                  action: "quota.reservation_release_failed",
                  reservationId,
                  error: err instanceof Error ? err.message : String(err),
                  ts: new Date().toISOString(),
                })
              );
            }
          });
        }
      }
    });
  } catch (err: unknown) {
    console.error("Eroare AI Multi:", err instanceof Error ? err.message : err);
    return aiFailure(c, "Eroare la analiza AI avansata. Verificati cheile API si incercati din nou.");
  }
});

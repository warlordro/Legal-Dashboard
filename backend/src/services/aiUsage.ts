import { insertAiUsage, type AiUsageProvider } from "../db/aiUsageRepository.ts";

export type { AiUsageProvider };

export interface AiUsageTrackingContext {
  ownerId: string;
  feature: string;
  requestId?: string;
}

export interface AiUsageCallMeta {
  usageInput?: number;
  usageOutput?: number;
  httpStatus?: number;
}

interface ModelPrice {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

// Provider keys MUST match the ai_usage.provider CHECK in
// `backend/src/db/migrations/0010_ai_usage.up.sql` ('anthropic'/'openai'/'google').
// Adding a provider requires a paired migration that widens the CHECK and a new
// entry here; otherwise either insert fails (CHECK) or cost stays at 0 (no entry).
// modelIds MUST match the entries in `backend/src/services/ai.ts:AI_MODELS`.
// Missing modelIds default to cost=0 with a one-shot warning logged below.
const MODEL_PRICES_USD_PER_MILLION: Record<AiUsageProvider, Record<string, ModelPrice>> = {
  anthropic: {
    "claude-haiku-4-5-20251001": { inputUsdPerMillion: 1, outputUsdPerMillion: 5 },
    "claude-sonnet-4-6": { inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
    "claude-opus-4-6": { inputUsdPerMillion: 15, outputUsdPerMillion: 75 },
  },
  openai: {
    "gpt-5.4-nano": { inputUsdPerMillion: 0.05, outputUsdPerMillion: 0.4 },
    "gpt-5.4-mini": { inputUsdPerMillion: 0.25, outputUsdPerMillion: 2 },
    "gpt-5.4": { inputUsdPerMillion: 1.25, outputUsdPerMillion: 10 },
  },
  google: {
    "gemini-3.1-flash-lite-preview": { inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.4 },
    "gemini-3-flash-preview": { inputUsdPerMillion: 0.3, outputUsdPerMillion: 2.5 },
    "gemini-3.1-pro-preview": { inputUsdPerMillion: 1.25, outputUsdPerMillion: 10 },
  },
};

// Tracks (provider, model) pairs already warned about so a missing price
// produces one boot-time log line per model, not one per AI call.
const warnedMissingPrice = new Set<string>();

// Tokens may legitimately be zero (e.g. function-calling round-trip with no
// input text), so the predicate is `< 0`, not `<= 0`. Anything not a finite
// non-negative number collapses to 0 to satisfy the CHECK constraint.
function safeTokenCount(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

// http_status column is integer-typed; SDK errors occasionally surface
// non-status values (e.g. 0 on network failure, ECONNRESET strings already
// stripped to NaN, vendor-specific 7xx). Pin to the IANA range and otherwise
// drop to NULL so dashboards filtering by status code stay sane.
function safeHttpStatus(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.floor(value);
  if (rounded < 100 || rounded > 599) return null;
  return rounded;
}

export function estimateAiCostUsdMilli(input: {
  provider: AiUsageProvider;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}): number {
  const price = MODEL_PRICES_USD_PER_MILLION[input.provider]?.[input.model];
  if (!price) {
    const key = `${input.provider}|${input.model}`;
    if (!warnedMissingPrice.has(key)) {
      warnedMissingPrice.add(key);
      console.warn(
        JSON.stringify({
          action: "ai_usage.price_missing",
          provider: input.provider,
          model: input.model,
          ts: new Date().toISOString(),
        })
      );
    }
    return 0;
  }

  const inputTokens = safeTokenCount(input.inputTokens);
  const outputTokens = safeTokenCount(input.outputTokens);
  if (inputTokens === 0 && outputTokens === 0) return 0;

  const usd =
    (inputTokens * price.inputUsdPerMillion) / 1_000_000 + (outputTokens * price.outputUsdPerMillion) / 1_000_000;
  return Math.max(0, Math.round(usd * 1_000));
}

export function recordAiUsageSafely(input: {
  tracking?: AiUsageTrackingContext;
  provider: AiUsageProvider;
  model: string;
  meta?: AiUsageCallMeta;
  wasAborted?: boolean;
}): void {
  if (!input.tracking) return;

  const inputTokens = safeTokenCount(input.meta?.usageInput);
  const outputTokens = safeTokenCount(input.meta?.usageOutput);
  const costUsdMilli = estimateAiCostUsdMilli({
    provider: input.provider,
    model: input.model,
    inputTokens,
    outputTokens,
  });
  const httpStatus = safeHttpStatus(input.meta?.httpStatus);
  const tracking = input.tracking;
  const provider = input.provider;
  const model = input.model;
  const wasAborted = input.wasAborted;

  // Defer the synchronous SQLite write off the response hot path. The
  // microtask still runs in this turn (no event-loop yield), so the row
  // lands within the same request's lifecycle, but the caller (e.g. the
  // streamSSE multi-agent flow) returns its bytes first. Errors are
  // captured below so an unhandled microtask rejection cannot escape.
  queueMicrotask(() => {
    try {
      insertAiUsage({
        ownerId: tracking.ownerId,
        provider,
        model,
        feature: tracking.feature,
        inputTokens,
        outputTokens,
        costUsdMilli,
        httpStatus,
        wasAborted,
        requestId: tracking.requestId,
      });
    } catch (e) {
      // Structured single-line JSON so log scrapers can grep
      // `"action":"ai_usage.persist_failed"`. Mirrors the shape used by
      // backup/restore audit lines in `db/backup.ts`.
      console.warn(
        JSON.stringify({
          action: "ai_usage.persist_failed",
          provider,
          model,
          feature: tracking.feature,
          owner_id: tracking.ownerId,
          request_id: tracking.requestId ?? null,
          error: e instanceof Error ? e.message : String(e),
          ts: new Date().toISOString(),
        })
      );
    }
  });
}

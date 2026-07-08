import { insertAiUsage, type AiUsageProvider, type AiUsageRoutingTag } from "../db/aiUsageRepository.ts";
import { confirmAiUsageReservation } from "../db/aiUsageRepository.ts";
import { getAuthMode } from "../auth/config.ts";
import { checkBudgetWarning } from "./budgetWarningService.ts";

export type { AiUsageProvider };
export type { AiUsageRoutingTag };

export interface AiUsageTrackingContext {
  ownerId: string;
  feature: string;
  requestId?: string;
  reservationId?: number | null;
}

export interface AiUsageCallMeta {
  usageInput?: number;
  usageOutput?: number;
  httpStatus?: number;
  costUsdMilli?: number | null;
  routingTag?: AiUsageRoutingTag;
  latencyMs?: number;
  errorType?: string;
}

interface ModelPrice {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

// Provider keys MUST match the ai_usage.provider CHECK in the latest migration.
// Adding a provider requires a paired migration that widens the CHECK and a new
// entry here; otherwise either insert fails (CHECK) or cost stays at 0 (no entry).
// modelIds MUST match the entries in `backend/src/services/ai.ts:AI_MODELS`.
// Missing modelIds default to cost=0 with a one-shot warning logged below.
const MODEL_PRICES_USD_PER_MILLION: Record<AiUsageProvider, Record<string, ModelPrice>> = {
  anthropic: {
    "claude-haiku-4-5-20251001": { inputUsdPerMillion: 1, outputUsdPerMillion: 5 },
    // v2.42.0 (5.6): Sonnet 5 la tariful STANDARD $3/$15 — NU promo-ul de
    // lansare $2/$10 valabil doar pana la 31 aug 2026 (decizie user: bugetele
    // nu se calibreaza pe reduceri temporare). Intrarea 4-6 ramane pentru
    // retry-uri/cozi in zbor din jurul upgrade-ului; istoricul are costul
    // stocat la insert.
    "claude-sonnet-5": { inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
    "claude-sonnet-4-6": { inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
    "claude-opus-4-8": { inputUsdPerMillion: 5, outputUsdPerMillion: 25 },
  },
  openai: {
    "gpt-5.4-nano": { inputUsdPerMillion: 0.05, outputUsdPerMillion: 0.4 },
    "gpt-5.4-mini": { inputUsdPerMillion: 0.25, outputUsdPerMillion: 2 },
    "gpt-5.4": { inputUsdPerMillion: 1.25, outputUsdPerMillion: 10 },
  },
  google: {
    "gemini-3.1-flash-lite-preview": { inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.4 },
    "gemini-3.5-flash": { inputUsdPerMillion: 1.5, outputUsdPerMillion: 9 },
    "gemini-3.1-pro-preview": { inputUsdPerMillion: 1.25, outputUsdPerMillion: 10 },
  },
  openrouter: {
    "anthropic/claude-haiku-4.5": { inputUsdPerMillion: 1, outputUsdPerMillion: 5 },
    "anthropic/claude-sonnet-5": { inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
    "anthropic/claude-sonnet-4.6": { inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
    "anthropic/claude-opus-4.8": { inputUsdPerMillion: 5, outputUsdPerMillion: 25 },
    "openai/gpt-5.4-nano": { inputUsdPerMillion: 0.05, outputUsdPerMillion: 0.4 },
    "openai/gpt-5.4-mini": { inputUsdPerMillion: 0.25, outputUsdPerMillion: 2 },
    "openai/gpt-5.4": { inputUsdPerMillion: 2.5, outputUsdPerMillion: 10 },
    "google/gemini-3.1-flash-lite-preview": { inputUsdPerMillion: 0.075, outputUsdPerMillion: 0.3 },
    "google/gemini-3.5-flash": { inputUsdPerMillion: 1.5, outputUsdPerMillion: 9 },
    "google/gemini-3.1-pro-preview": { inputUsdPerMillion: 1.25, outputUsdPerMillion: 10 },
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

function safeCostUsdMilli(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

// latency_ms column is integer-typed; drop non-finite or negative values to
// NULL so latency dashboards never average over junk, otherwise round to the
// nearest millisecond.
function safeLatencyMs(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

// error_type is a TEXT column with no CHECK; cap at 128 chars so a runaway
// error name/message can't bloat the row, and drop empty strings to NULL.
function safeErrorType(value: string | undefined): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return value.slice(0, 128);
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
  const directCostUsdMilli = safeCostUsdMilli(input.meta?.costUsdMilli);
  const costUsdMilli =
    directCostUsdMilli ??
    estimateAiCostUsdMilli({
      provider: input.provider,
      model: input.model,
      inputTokens,
      outputTokens,
    });
  const httpStatus = safeHttpStatus(input.meta?.httpStatus);
  const routingTag = input.meta?.routingTag;
  const latencyMs = safeLatencyMs(input.meta?.latencyMs);
  const errorType = safeErrorType(input.meta?.errorType);
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
      const reservationId = tracking.reservationId;
      if (reservationId != null) {
        confirmAiUsageReservation(reservationId, {
          provider,
          model,
          inputTokens,
          outputTokens,
          costUsdMilli,
          httpStatus,
          wasAborted: wasAborted ?? false,
          routingTag: routingTag ?? null,
          feature: tracking.feature,
          latencyMs,
          errorType,
        });
      } else {
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
          routingTag,
          latencyMs,
          errorType,
        });
      }
      // v2.32.0: dupa write reusit, verifica pragul 80% (web mode only).
      // Failure-ul aici nu trebuie sa ridice exceptie peste insertAiUsage —
      // catch separat in checkBudgetWarning, dar tot wrap-uit aici ca un
      // throw sincron sa nu rupa microtask-ul.
      if (getAuthMode() === "web") {
        checkBudgetWarning(tracking.ownerId, tracking.feature).catch((warnErr) => {
          console.warn(
            JSON.stringify({
              action: "budget_warning.check_failed",
              owner_id: tracking.ownerId,
              feature: tracking.feature,
              error: warnErr instanceof Error ? warnErr.message : String(warnErr),
              ts: new Date().toISOString(),
            })
          );
        });
      }
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

import {
  insertAiUsage,
  type AiUsageProvider,
} from "../db/aiUsageRepository.ts";

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

function safeTokenCount(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

export function estimateAiCostUsdMilli(input: {
  provider: AiUsageProvider;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}): number {
  const price = MODEL_PRICES_USD_PER_MILLION[input.provider]?.[input.model];
  if (!price) return 0;

  const inputTokens = safeTokenCount(input.inputTokens);
  const outputTokens = safeTokenCount(input.outputTokens);
  if (inputTokens === 0 && outputTokens === 0) return 0;

  const usd =
    (inputTokens * price.inputUsdPerMillion) / 1_000_000 +
    (outputTokens * price.outputUsdPerMillion) / 1_000_000;
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

  try {
    insertAiUsage({
      ownerId: input.tracking.ownerId,
      provider: input.provider,
      model: input.model,
      feature: input.tracking.feature,
      inputTokens,
      outputTokens,
      costUsdMilli,
      httpStatus: input.meta?.httpStatus,
      wasAborted: input.wasAborted,
      requestId: input.tracking.requestId,
    });
  } catch (e) {
    console.warn("[ai_usage] failed to persist usage row:", e instanceof Error ? e.message : e);
  }
}

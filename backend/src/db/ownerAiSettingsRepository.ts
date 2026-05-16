import { getDb } from "./schema.ts";

export type AiProviderMode = "native" | "openrouter";
export type OpenRouterStack = "western" | "chinese";

export interface OwnerAiSettings {
  owner_id: string;
  mode: AiProviderMode;
  openrouter_stack: OpenRouterStack;
  updated_at: number;
}

export interface UpsertOwnerAiSettingsInput {
  mode: AiProviderMode;
  openrouter_stack: OpenRouterStack;
}

const COLUMNS = "owner_id, mode, openrouter_stack, updated_at";

function nowMs(): number {
  return Date.now();
}

function assertMode(mode: string): asserts mode is AiProviderMode {
  if (mode !== "native" && mode !== "openrouter") {
    throw new Error("invalid ai settings mode");
  }
}

function assertStack(stack: string): asserts stack is OpenRouterStack {
  if (stack !== "western" && stack !== "chinese") {
    throw new Error("invalid openrouter stack");
  }
}

function toDomain(row: OwnerAiSettings): OwnerAiSettings {
  assertMode(row.mode);
  assertStack(row.openrouter_stack);
  return {
    owner_id: row.owner_id,
    mode: row.mode,
    openrouter_stack: row.openrouter_stack,
    updated_at: row.updated_at,
  };
}

export function getSettings(ownerId: string): OwnerAiSettings {
  const row = getDb().prepare(`SELECT ${COLUMNS} FROM owner_ai_settings WHERE owner_id = ?`).get(ownerId) as
    | OwnerAiSettings
    | undefined;

  if (row) return toDomain(row);
  return {
    owner_id: ownerId,
    mode: "native",
    openrouter_stack: "western",
    updated_at: 0,
  };
}

export function upsertSettings(ownerId: string, input: UpsertOwnerAiSettingsInput): OwnerAiSettings {
  assertMode(input.mode);
  assertStack(input.openrouter_stack);

  const updatedAt = nowMs();
  getDb()
    .prepare(
      `INSERT INTO owner_ai_settings
         (owner_id, mode, openrouter_stack, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(owner_id) DO UPDATE SET
         mode = excluded.mode,
         openrouter_stack = excluded.openrouter_stack,
         updated_at = excluded.updated_at`
    )
    .run(ownerId, input.mode, input.openrouter_stack, updatedAt);

  return getSettings(ownerId);
}

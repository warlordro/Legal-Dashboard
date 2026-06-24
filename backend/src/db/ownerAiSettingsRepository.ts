import { getDb } from "./schema.ts";
import { assertOwnerIdForMutation } from "../util/ownerGuard.ts";

export type AiProviderMode = "native" | "openrouter";

export interface OwnerAiSettings {
  owner_id: string;
  mode: AiProviderMode;
  updated_at: number;
}

export interface UpsertOwnerAiSettingsInput {
  mode: AiProviderMode;
}

const COLUMNS = "owner_id, mode, updated_at";

function nowMs(): number {
  return Date.now();
}

function assertMode(mode: string): asserts mode is AiProviderMode {
  if (mode !== "native" && mode !== "openrouter") {
    throw new Error("invalid ai settings mode");
  }
}

function toDomain(row: OwnerAiSettings): OwnerAiSettings {
  assertMode(row.mode);
  return {
    owner_id: row.owner_id,
    mode: row.mode,
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
    updated_at: 0,
  };
}

export function upsertSettings(ownerId: string, input: UpsertOwnerAiSettingsInput): OwnerAiSettings {
  assertOwnerIdForMutation(ownerId, "upsertSettings(ownerAi)");
  assertMode(input.mode);

  const updatedAt = nowMs();
  // openrouter_stack: coloana legacy (v2.38.0 a eliminat stack-ul chinezesc);
  // ramane in schema pentru a evita rebuild-ul tabelei, se scrie constant 'western'.
  getDb()
    .prepare(
      `INSERT INTO owner_ai_settings
         (owner_id, mode, openrouter_stack, updated_at)
       VALUES (?, ?, 'western', ?)
       ON CONFLICT(owner_id) DO UPDATE SET
         mode = excluded.mode,
         openrouter_stack = excluded.openrouter_stack,
         updated_at = excluded.updated_at`
    )
    .run(ownerId, input.mode, updatedAt);

  return getSettings(ownerId);
}

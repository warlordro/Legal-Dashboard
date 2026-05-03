import { getDb } from "./schema.ts";

// v2.10.1 note: `min_severity` ramane stocat per-owner, dar dispatcher-ul NU
// foloseste valoarea ca filtru — design explicit din v2.10.0 ("email = toate
// alertele noi de monitorizare cand canalul este activ"). Coloana ramane pe
// schema ca seam pentru un viitor preset filtrat. SQL-ul din 0014.up.sql
// declara DEFAULT 'warning' pentru min_severity; codul Node nu loveste niciodata
// default-ul fiindca `upsertEmailSettings` ataseaza intotdeauna o valoare
// explicita ('info' cand input-ul nu o specifica) — discrepanta e doar pentru
// raw-SQL tooling, nu pentru runtime-ul aplicatiei.

export type EmailMinSeverity = "info" | "warning" | "critical";

export interface EmailSettings {
  ownerId: string;
  enabled: boolean;
  toAddress: string | null;
  minSeverity: EmailMinSeverity;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertEmailSettingsInput {
  enabled: boolean;
  toAddress: string | null;
  minSeverity: EmailMinSeverity;
}

interface EmailSettingsRow {
  owner_id: string;
  enabled: number;
  to_address: string | null;
  min_severity: EmailMinSeverity;
  created_at: string;
  updated_at: string;
}

const COLUMNS = "owner_id, enabled, to_address, min_severity, created_at, updated_at";
const EMAIL_MAX_LENGTH = 320;

function normalizeToAddress(toAddress: string | null): string | null {
  if (toAddress === null) return null;
  const trimmed = toAddress.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > EMAIL_MAX_LENGTH) {
    throw new Error(`invalid to_address: max ${EMAIL_MAX_LENGTH} characters`);
  }
  return trimmed;
}

function toDomain(row: EmailSettingsRow): EmailSettings {
  return {
    ownerId: row.owner_id,
    enabled: row.enabled === 1,
    toAddress: row.to_address,
    minSeverity: row.min_severity,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getEmailSettings(ownerId: string): EmailSettings | null {
  const row = getDb()
    .prepare(`SELECT ${COLUMNS} FROM owner_email_settings WHERE owner_id = ?`)
    .get(ownerId) as EmailSettingsRow | undefined;
  return row ? toDomain(row) : null;
}

export function upsertEmailSettings(
  ownerId: string,
  input: UpsertEmailSettingsInput,
): EmailSettings {
  const toAddress = normalizeToAddress(input.toAddress);
  getDb()
    .prepare(
      `INSERT INTO owner_email_settings
         (owner_id, enabled, to_address, min_severity, created_at, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(owner_id) DO UPDATE SET
         enabled = excluded.enabled,
         to_address = excluded.to_address,
         min_severity = excluded.min_severity,
         updated_at = datetime('now')`,
    )
    .run(ownerId, input.enabled ? 1 : 0, toAddress, input.minSeverity);
  return getEmailSettings(ownerId) as EmailSettings;
}

export function defaultEmailSettingsFor(ownerId: string): EmailSettings {
  const now = new Date(0).toISOString();
  return {
    ownerId,
    enabled: false,
    toAddress: null,
    minSeverity: "info",
    createdAt: now,
    updatedAt: now,
  };
}

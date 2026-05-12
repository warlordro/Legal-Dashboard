import { getDb } from "./schema.ts";

// v2.10.1 note: `min_severity` ramane stocat per-owner, dar dispatcher-ul NU
// foloseste valoarea ca filtru — design explicit din v2.10.0 ("email = toate
// alertele noi de monitorizare cand canalul este activ"). Coloana ramane pe
// schema ca seam pentru un viitor preset filtrat. SQL-ul din 0014.up.sql
// declara DEFAULT 'warning' pentru min_severity; codul Node nu loveste niciodata
// default-ul fiindca `upsertEmailSettings` ataseaza intotdeauna o valoare
// explicita ('info' cand input-ul nu o specifica) — discrepanta e doar pentru
// raw-SQL tooling, nu pentru runtime-ul aplicatiei.
//
// v2.13.0: daily_report_enabled + last_daily_report_sent_for adaugate de
// migration 0015. daily report e canal separat de per-alert email; pot fi
// active independent (un owner poate avea ambele, doar unul, sau niciunul).

export type EmailMinSeverity = "info" | "warning" | "critical";

export interface EmailSettings {
  ownerId: string;
  enabled: boolean;
  toAddress: string | null;
  minSeverity: EmailMinSeverity;
  dailyReportEnabled: boolean;
  lastDailyReportSentFor: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertEmailSettingsInput {
  enabled: boolean;
  toAddress: string | null;
  minSeverity: EmailMinSeverity;
  // Optional la layer-ul de tipuri — daca nu e specificat, upsert-ul scrie
  // 0 (off). Pastreaza compat cu testele si call-site-urile vechi care nu
  // cunosc inca flag-ul de daily report (introdus in v2.13.0).
  dailyReportEnabled?: boolean;
}

interface EmailSettingsRow {
  owner_id: string;
  enabled: number;
  to_address: string | null;
  min_severity: EmailMinSeverity;
  daily_report_enabled: number;
  last_daily_report_sent_for: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  "owner_id, enabled, to_address, min_severity, daily_report_enabled, last_daily_report_sent_for, created_at, updated_at";
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
    dailyReportEnabled: row.daily_report_enabled === 1,
    lastDailyReportSentFor: row.last_daily_report_sent_for,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getEmailSettings(ownerId: string): EmailSettings | null {
  const row = getDb().prepare(`SELECT ${COLUMNS} FROM owner_email_settings WHERE owner_id = ?`).get(ownerId) as
    | EmailSettingsRow
    | undefined;
  return row ? toDomain(row) : null;
}

export function upsertEmailSettings(ownerId: string, input: UpsertEmailSettingsInput): EmailSettings {
  const toAddress = normalizeToAddress(input.toAddress);
  getDb()
    .prepare(
      `INSERT INTO owner_email_settings
         (owner_id, enabled, to_address, min_severity, daily_report_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(owner_id) DO UPDATE SET
         enabled = excluded.enabled,
         to_address = excluded.to_address,
         min_severity = excluded.min_severity,
         daily_report_enabled = excluded.daily_report_enabled,
         updated_at = datetime('now')`
    )
    .run(ownerId, input.enabled ? 1 : 0, toAddress, input.minSeverity, input.dailyReportEnabled === true ? 1 : 0);
  return getEmailSettings(ownerId) as EmailSettings;
}

export function defaultEmailSettingsFor(ownerId: string): EmailSettings {
  const now = new Date(0).toISOString();
  return {
    ownerId,
    enabled: false,
    toAddress: null,
    minSeverity: "info",
    dailyReportEnabled: false,
    lastDailyReportSentFor: null,
    createdAt: now,
    updatedAt: now,
  };
}

// v2.13.0: helper folosit de dailyReportScheduler dupa trimiterea reusita
// pentru a marca ziua respectiva si a evita re-trimiterea intr-un singur
// tick / restart. Argumentul `dateLocal` este formatul YYYY-MM-DD ora locala
// server (vezi services/email/dailyReportScheduler.ts).
export function markDailyReportSent(ownerId: string, dateLocal: string): void {
  getDb()
    .prepare(
      "UPDATE owner_email_settings SET last_daily_report_sent_for = ?, updated_at = datetime('now') WHERE owner_id = ?"
    )
    .run(dateLocal, ownerId);
}

// v2.13.0: lista candidatilor pentru daily digest. Filtru SQL strict:
// daily_report_enabled = 1 AND (last_daily_report_sent_for IS NULL OR != today).
// Filtrul `to_address IS NOT NULL` ramane in scheduler ca verificare finala
// (un owner poate avea daily_report_enabled = 1 dar to_address NULL daca
// l-a sters dupa ce a activat raportul; in acest caz log + skip).
export function listDailyReportCandidates(todayLocal: string): EmailSettings[] {
  const rows = getDb()
    .prepare(
      `SELECT ${COLUMNS} FROM owner_email_settings
       WHERE daily_report_enabled = 1
         AND (last_daily_report_sent_for IS NULL OR last_daily_report_sent_for != ?)`
    )
    .all(todayLocal) as EmailSettingsRow[];
  return rows.map(toDomain);
}

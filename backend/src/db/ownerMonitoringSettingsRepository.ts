// Per-owner master switch pentru monitoring claim. Migration 0020 introduce
// `owner_monitoring_settings(owner_id, monitoring_enabled, created_at, updated_at)`.
//
// Semantica master-switch:
//   - Rand lipsa     -> tratat ca enabled (default 1 din DDL + default in cod).
//   - monitoring_enabled = 0 -> scheduler-ul nu claim-uieste joburile ownerului
//     (vezi anti-join in `claimDueJobs`), fara mutatii pe per-job state.
//   - Re-enable -> joburile due in fereastra de pauza vor fi claim-uite pe
//     tickurile urmatoare (next_run_at deja in trecut).
//
// Acest fisier intentionat oglindeste forma stabilita in `ownerEmailSettingsRepository.ts`:
// raw row interface + `toDomain` + `COLUMNS` constant + UPSERT cu ON CONFLICT.
// Divergenta intentionata: timestamp-urile folosesc `strftime('%Y-%m-%dT%H:%M:%fZ','now')`
// (ISO-8601 cu milisecunde + Z) ca sa fie aliniate cu DEFAULT-ul din migration 0020,
// in timp ce `ownerEmailSettingsRepository.ts` foloseste `datetime('now')` (rezolutie sec).
// Ambele sunt UTC; consumatorii citesc string-ul ca data UTC fara conversie.
//
// `setMonitoringEnabled` este idempotent: SELECT pre-state -> compara cu
// requested -> UPSERT doar daca s-a schimbat, iar `changed` boolean reflecta
// schimbarea logica (NU touch-ul de `updated_at`). Default-ul pentru randul
// lipsa este `true`, deci `setMonitoringEnabled("local", true)` pe rand absent
// e un no-op cu `{ changed: false }` — evita poluare audit log la prima
// activare a unui canal care era deja activ implicit.

import { getDb } from "./schema.ts";
import { assertOwnerIdForMutation } from "../util/ownerGuard.ts";

export interface OwnerMonitoringSettings {
  owner_id: string;
  monitoring_enabled: 0 | 1;
  created_at: string;
  updated_at: string;
}

interface OwnerMonitoringSettingsRow {
  owner_id: string;
  monitoring_enabled: number;
  created_at: string;
  updated_at: string;
}

const COLUMNS = "owner_id, monitoring_enabled, created_at, updated_at";

function toDomain(row: OwnerMonitoringSettingsRow): OwnerMonitoringSettings {
  return {
    owner_id: row.owner_id,
    monitoring_enabled: row.monitoring_enabled === 1 ? 1 : 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// Full-row getter — folosit in teste si in eventuali consumatori care vor sa
// inspecteze timestamp-urile. Productie call-path-ul scheduler-ului foloseste
// `getMonitoringEnabled` (mai jos).
export function getOwnerMonitoringSettings(ownerId: string): OwnerMonitoringSettings | null {
  const row = getDb().prepare(`SELECT ${COLUMNS} FROM owner_monitoring_settings WHERE owner_id = ?`).get(ownerId) as
    | OwnerMonitoringSettingsRow
    | undefined;
  return row ? toDomain(row) : null;
}

// Boolean view, cu default `true` cand randul lipseste. Acesta este contractul
// public — restul aplicatiei nu trebuie sa stie ca DB-ul foloseste 0/1.
export function getMonitoringEnabled(ownerId: string): boolean {
  const row = getDb()
    .prepare("SELECT monitoring_enabled FROM owner_monitoring_settings WHERE owner_id = ?")
    .get(ownerId) as { monitoring_enabled: number } | undefined;
  if (!row) return true;
  return row.monitoring_enabled === 1;
}

// Idempotent UPSERT. Returneaza { changed: true } DOAR daca starea logica s-a
// schimbat (pre-value vs requested), NU daca timestamp-ul s-a modificat.
// Caller-ul (route handler) decide pe baza acestui flag daca scrie audit row.
//
// Note importanta: pentru randul absent, default-ul efectiv este 1 (enabled).
// Deci `setMonitoringEnabled(owner, true)` pe owner fara rand este no-op
// (returneaza { changed: false }, nu inserteaza rand). Acest design evita
// audit rows duplicate pentru "active -> active" pe ownerii noi.
export function setMonitoringEnabled(ownerId: string, enabled: boolean): { changed: boolean } {
  assertOwnerIdForMutation(ownerId, "setMonitoringEnabled");
  const db = getDb();
  const row = db.prepare("SELECT monitoring_enabled FROM owner_monitoring_settings WHERE owner_id = ?").get(ownerId) as
    | { monitoring_enabled: number }
    | undefined;

  const currentEnabled = row ? row.monitoring_enabled === 1 : true;
  if (currentEnabled === enabled) {
    return { changed: false };
  }

  db.prepare(
    `INSERT INTO owner_monitoring_settings
       (owner_id, monitoring_enabled, created_at, updated_at)
     VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(owner_id) DO UPDATE SET
       monitoring_enabled = excluded.monitoring_enabled,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  ).run(ownerId, enabled ? 1 : 0);

  return { changed: true };
}

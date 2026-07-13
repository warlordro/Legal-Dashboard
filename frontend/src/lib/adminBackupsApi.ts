// v2.43.0 (rnpm-split): API-ul de backup al MONOLITULUI (baza unica), admin-only
// — consumat de tab-ul Setari > Backup. Backup-urile RNPM per user raman in
// rnpmApi.ts (self-service).

import { apiFetch, unwrapMonitoring } from "@/lib/api";
import type { RnpmBackupEntry } from "@/lib/rnpmApi";

export type BackupEntry = RnpmBackupEntry;

const BASE = "/api/v1/admin/backups";

export async function adminListBackups(): Promise<BackupEntry[]> {
  const data = await unwrapMonitoring<{ backups: BackupEntry[] }>(await apiFetch(BASE));
  return data.backups;
}

export async function adminCreateBackup(): Promise<{ name: string }> {
  return unwrapMonitoring<{ name: string }>(await apiFetch(`${BASE}/create`, { method: "POST" }));
}

export async function adminRestoreBackup(name: string): Promise<{ preRestoreName: string }> {
  return unwrapMonitoring<{ preRestoreName: string }>(
    await apiFetch(`${BASE}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    })
  );
}

export async function adminDeleteBackups(): Promise<number> {
  const data = await unwrapMonitoring<{ deleted: number }>(await apiFetch(BASE, { method: "DELETE" }));
  return data.deleted;
}

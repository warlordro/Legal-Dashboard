// v2.43.0 (rnpm-split): API-ul de backup al MONOLITULUI (baza unica), admin-only
// — consumat de tab-ul Setari > Backup. Backup-urile RNPM per user raman in
// rnpmApi.ts (self-service).

import { apiFetch, extractErrorMessage } from "@/lib/api";
import type { RnpmBackupEntry } from "@/lib/rnpmApi";

export type BackupEntry = RnpmBackupEntry;

const BASE = "/api/v1/admin/backups";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    const snippet = text.slice(0, 300).trim();
    throw new Error(res.ok ? "Raspuns invalid" : `Eroare server (${res.status}): ${snippet || "(corp gol)"}`);
  }
  if (!res.ok) {
    throw new Error(extractErrorMessage(data, `Eroare server (${res.status})`));
  }
  return data as T;
}

export async function adminListBackups(): Promise<BackupEntry[]> {
  const res = await apiFetch(BASE);
  const data = await jsonOrThrow<{ backups: BackupEntry[] }>(res);
  return data.backups;
}

export async function adminCreateBackup(): Promise<{ name: string }> {
  const res = await apiFetch(`${BASE}/create`, { method: "POST" });
  const data = await jsonOrThrow<{ ok: true; name: string }>(res);
  return { name: data.name };
}

export async function adminRestoreBackup(name: string): Promise<{ preRestoreName: string }> {
  const res = await apiFetch(`${BASE}/restore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return jsonOrThrow<{ ok: true; preRestoreName: string }>(res);
}

export async function adminDeleteBackups(): Promise<number> {
  const res = await apiFetch(BASE, { method: "DELETE" });
  const data = await jsonOrThrow<{ deleted: number }>(res);
  return data.deleted;
}

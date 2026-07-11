// v2.43.x (admin rnpm storage): client pentru GET /api/v1/admin/rnpm/usage —
// envelope standard, erori prin unwrapMonitoring (code/status/requestId pastrate).
import { apiFetch, unwrapMonitoring } from "@/lib/api";

export interface AdminRnpmUsageRow {
  userId: string;
  email: string;
  displayName: string;
  status: string;
  dbSizeBytes: number | null;
  backupCount: number;
  backupsBytes: number;
}

export async function adminListRnpmUsage(signal?: AbortSignal): Promise<AdminRnpmUsageRow[]> {
  const data = await unwrapMonitoring<{ rows: AdminRnpmUsageRow[] }>(
    await apiFetch("/api/v1/admin/rnpm/usage", { signal })
  );
  return data.rows;
}

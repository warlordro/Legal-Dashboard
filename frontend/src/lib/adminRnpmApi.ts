// v2.43.x (admin rnpm storage): client pentru GET /api/v1/admin/rnpm/usage —
// envelope standard, erori prin unwrapMonitoring (code/status/requestId pastrate).
import { apiFetch, unwrapMonitoring } from "@/lib/api";

export interface AdminRnpmUsageRow {
  userId: string;
  email: string;
  displayName: string;
  status: string;
  dbSizeBytes: number | null;
  storageLimitBytes?: number | null;
  backupCount: number;
  backupsBytes: number;
}

export interface AdminRnpmUsagePage {
  rows: AdminRnpmUsageRow[];
  page: number;
  pageSize: number;
  total: number;
}

// CodeRabbit 1.6: ruta e paginata — per rand se fac masuratori de fisier si listari de
// director, deci la cateva sute de useri o cerere nelimitata devine lenta.
export async function adminListRnpmUsage(
  params: { page?: number; pageSize?: number; includeInactive?: boolean } = {},
  signal?: AbortSignal
): Promise<AdminRnpmUsagePage> {
  const qs = new URLSearchParams();
  if (params.page) qs.set("page", String(params.page));
  if (params.pageSize) qs.set("pageSize", String(params.pageSize));
  // Filtrul ruleaza pe SERVER, inaintea paginarii — altfel o pagina putea aparea goala
  // desi urmatoarele aveau date, iar totalul afisat nu corespundea tabelului.
  if (params.includeInactive) qs.set("includeInactive", "1");
  const suffix = qs.toString() ? `?${qs}` : "";
  return unwrapMonitoring<AdminRnpmUsagePage>(await apiFetch(`/api/v1/admin/rnpm/usage${suffix}`, { signal }));
}

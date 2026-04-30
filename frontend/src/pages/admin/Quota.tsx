import { useCallback, useEffect, useState } from "react";
import { Gauge, RefreshCw, Search, Trash2, Plus, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  admin,
  type AdminUser,
  type QuotaOverride,
} from "@/lib/api";
import { cn } from "@/lib/utils";

// Daily limits are stored as integer milli-USD ($0.001 = 1 milli) to match the
// AI usage cost model from PR-7. UI exposes USD with up to 3-decimal precision.
const MILLI = 1000;

function milliToUsd(milli: number): string {
  return (milli / MILLI).toFixed(3);
}

function parseUsdInputToMilli(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * MILLI);
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ro-RO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminQuota() {
  const confirm = useConfirm();
  const [searchInput, setSearchInput] = useState("");
  const [candidates, setCandidates] = useState<AdminUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [overrides, setOverrides] = useState<QuotaOverride[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feature, setFeature] = useState("");
  const [limitUsd, setLimitUsd] = useState("");
  const [busyFeature, setBusyFeature] = useState<string | null>(null);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchInput.trim();
    if (!q) return;
    setSearching(true);
    setError(null);
    try {
      const result = await admin.listUsers({ search: q, pageSize: 25 });
      setCandidates(result.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la cautare.");
    } finally {
      setSearching(false);
    }
  };

  const loadOverrides = useCallback(async (userId: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await admin.listQuota(userId);
      setOverrides(result.overrides);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la incarcarea cotelor.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selected) loadOverrides(selected.id);
    else setOverrides([]);
  }, [loadOverrides, selected]);

  const onSelect = (user: AdminUser) => {
    setSelected(user);
    setCandidates([]);
    setFeature("");
    setLimitUsd("");
  };

  const onUpsert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    const featureKey = feature.trim();
    if (!featureKey) {
      setError("Introdu un nume pentru feature.");
      return;
    }
    const milli = parseUsdInputToMilli(limitUsd);
    if (milli === null) {
      setError("Introdu o limita zilnica valida (>= 0).");
      return;
    }
    setBusyFeature(featureKey);
    setError(null);
    try {
      await admin.upsertQuota(selected.id, featureKey, milli);
      await loadOverrides(selected.id);
      setFeature("");
      setLimitUsd("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la salvarea cotei.");
    } finally {
      setBusyFeature(null);
    }
  };

  const onDelete = async (override: QuotaOverride) => {
    if (!selected) return;
    const ok = await confirm({
      title: "Sterge cota",
      message: `Sterge override-ul pentru "${override.feature}" (${milliToUsd(override.dailyLimitUsdMilli)} $/zi)? Userul va reveni la limita default.`,
      destructive: true,
      confirmLabel: "Sterge",
    });
    if (!ok) return;
    setBusyFeature(override.feature);
    setError(null);
    try {
      await admin.deleteQuota(selected.id, override.feature);
      await loadOverrides(selected.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la stergerea cotei.");
    } finally {
      setBusyFeature(null);
    }
  };

  const startEdit = (override: QuotaOverride) => {
    setFeature(override.feature);
    setLimitUsd(milliToUsd(override.dailyLimitUsdMilli));
  };

  return (
    <div className="min-h-full bg-background p-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Gauge className="h-6 w-6 text-primary" />
            Cote utilizatori
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Override-uri zilnice per feature (in USD). Salvate ca milli-USD pentru aliniere cu modelul de cost AI.
          </p>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-red-700/70 hover:text-red-900 dark:text-red-300/70"
            >
              ×
            </button>
          </div>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Search className="h-4 w-4" />
              Selecteaza utilizator
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <form onSubmit={search} className="flex gap-2">
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Cauta dupa email sau nume"
                className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
              />
              <Button type="submit" disabled={searching}>
                <Search className={cn("h-4 w-4", searching && "animate-pulse")} />
                Cauta
              </Button>
            </form>
            {candidates.length > 0 && (
              <ul className="divide-y divide-border rounded-md border border-border">
                {candidates.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono">{c.email}</p>
                      <p className="text-xs text-muted-foreground">{c.displayName} · {c.role} · {c.status}</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => onSelect(c)}>
                      Selecteaza
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {selected && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                <span className="flex items-center gap-2">
                  <span className="font-mono text-sm">{selected.email}</span>
                  <Badge variant="outline">{selected.role}</Badge>
                  <Badge variant={selected.status === "active" ? "success" : "warning"}>
                    {selected.status}
                  </Badge>
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => loadOverrides(selected.id)} disabled={loading}>
                    <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                    Refresh
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                    Schimba utilizatorul
                  </Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={onUpsert} className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
                <input
                  type="text"
                  value={feature}
                  onChange={(e) => setFeature(e.target.value)}
                  placeholder="Feature (ex: ai.claude, monitoring.dosar)"
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                />
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  value={limitUsd}
                  onChange={(e) => setLimitUsd(e.target.value)}
                  placeholder="Limita / zi (USD)"
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                />
                <Button type="submit" disabled={busyFeature !== null}>
                  <Plus className="h-4 w-4" />
                  Salveaza
                </Button>
              </form>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Feature</th>
                      <th className="px-3 py-2 font-semibold">Limita / zi</th>
                      <th className="px-3 py-2 font-semibold">Actualizat</th>
                      <th className="px-3 py-2 font-semibold">De</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {overrides.length === 0 && !loading && (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                          Nu exista override-uri. Userul foloseste limita default.
                        </td>
                      </tr>
                    )}
                    {overrides.map((row) => (
                      <tr key={row.feature} className="border-b border-border last:border-b-0 hover:bg-muted/30">
                        <td className="px-3 py-2 align-top font-mono text-xs">{row.feature}</td>
                        <td className="px-3 py-2 align-top">
                          <span className="font-mono">${milliToUsd(row.dailyLimitUsdMilli)}</span>
                        </td>
                        <td className="px-3 py-2 align-top text-xs text-muted-foreground">{formatDateTime(row.updatedAt)}</td>
                        <td className="px-3 py-2 align-top font-mono text-xs">{row.updatedBy ?? "-"}</td>
                        <td className="px-3 py-2 align-top text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="ghost" onClick={() => startEdit(row)} disabled={busyFeature === row.feature}>
                              Editeaza
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => onDelete(row)}
                              disabled={busyFeature === row.feature}
                              className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/30"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

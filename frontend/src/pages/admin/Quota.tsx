import { useCallback, useEffect, useState } from "react";
import { Gauge, RefreshCw, Search, Trash2, Plus, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { admin, type AdminUser, type QuotaOverride, type QuotaPeriod } from "@/lib/api";
import { formatIsoDateTime } from "@/lib/datetime-formatters";
import { cn } from "@/lib/utils";

// Daily limits are stored as integer milli-USD ($0.001 = 1 milli) to match the
// AI usage cost model from PR-7. UI exposes USD with up to 3-decimal precision.
// v2.34.0 P1-4: pentru `captcha.*` valoarea stocata in `limit_usd_milli` se
// interpreteaza ca NUMAR (integer count de captcha-uri pe fereastra), nu USD.
// UI bypass-uieste conversia milli ca admin sa tasteze "50" si sa stocam 50.
const MILLI = 1000;

const PERIOD_LABELS: Record<QuotaPeriod, string> = {
  day: "Zilnic",
  week: "Saptamanal",
  month: "Lunar",
};

function isCountFeature(feature: string): boolean {
  return feature.startsWith("captcha.");
}

function formatStoredValue(feature: string, stored: number | null): string {
  if (stored === null) return "—";
  if (isCountFeature(feature)) return String(stored);
  return (stored / MILLI).toFixed(3);
}

function parseInputToStored(feature: string, value: string): number | null | "invalid" {
  const trimmed = value.trim();
  if (!trimmed) return "invalid";
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return "invalid";
  if (isCountFeature(feature)) {
    if (!Number.isInteger(n)) return "invalid";
    return n;
  }
  return Math.round(n * MILLI);
}

function limitUnitLabel(feature: string): string {
  return isCountFeature(feature) ? "captcha-uri" : "USD";
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
  const [period, setPeriod] = useState<QuotaPeriod>("day");
  const [limitUsd, setLimitUsd] = useState("");
  const [unlimited, setUnlimited] = useState(false);
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
    setPeriod("day");
    setLimitUsd("");
    setUnlimited(false);
  };

  const onUpsert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    const featureKey = feature.trim();
    if (!featureKey) {
      setError("Introdu un nume pentru feature.");
      return;
    }
    let limitUsdMilli: number | null;
    if (unlimited) {
      limitUsdMilli = null;
    } else {
      const parsed = parseInputToStored(featureKey, limitUsd);
      if (parsed === "invalid") {
        const hint = isCountFeature(featureKey)
          ? "Introdu un numar intreg >= 0 sau bifeaza 'Nelimitat'."
          : "Introdu o limita valida (>= 0) sau bifeaza 'Nelimitat'.";
        setError(hint);
        return;
      }
      limitUsdMilli = parsed;
    }
    setBusyFeature(featureKey);
    setError(null);
    try {
      await admin.upsertQuota(selected.id, {
        feature: featureKey,
        period,
        limitUsdMilli,
      });
      await loadOverrides(selected.id);
      setFeature("");
      setLimitUsd("");
      setPeriod("day");
      setUnlimited(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la salvarea cotei.");
    } finally {
      setBusyFeature(null);
    }
  };

  const onDelete = async (override: QuotaOverride) => {
    if (!selected) return;
    const limitLabel =
      override.limitUsdMilli === null
        ? "nelimitat"
        : isCountFeature(override.feature)
          ? `${override.limitUsdMilli} ${limitUnitLabel(override.feature)}`
          : `${formatStoredValue(override.feature, override.limitUsdMilli)} $`;
    const periodLabel = PERIOD_LABELS[override.period].toLowerCase();
    const ok = await confirm({
      title: "Sterge cota",
      message: `Sterge override-ul pentru "${override.feature}" (${limitLabel} / ${periodLabel})? Userul va reveni la limita default.`,
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
    setPeriod(override.period);
    if (override.limitUsdMilli === null) {
      setUnlimited(true);
      setLimitUsd("");
    } else {
      setUnlimited(false);
      setLimitUsd(formatStoredValue(override.feature, override.limitUsdMilli));
    }
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
            Override-uri pe rolling window (zi / saptamana / luna). Pentru `ai.*` limita e in USD (stocata milli),
            pentru `captcha.*` e numar de captcha-uri / fereastra. Bifeaza "Nelimitat" pentru a scoate capul.
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
                      <p className="text-xs text-muted-foreground">
                        {c.displayName} · {c.role} · {c.status}
                      </p>
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
                  <Badge variant={selected.status === "active" ? "success" : "warning"}>{selected.status}</Badge>
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
              <form onSubmit={onUpsert} className="grid gap-3 md:grid-cols-[1fr_140px_160px_auto] md:items-end">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground" htmlFor="quota-feature">
                    Feature
                  </label>
                  <input
                    id="quota-feature"
                    type="text"
                    value={feature}
                    onChange={(e) => setFeature(e.target.value)}
                    placeholder="ex: ai.single, ai.multi, captcha.rnpm"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground" htmlFor="quota-period">
                    Perioada
                  </label>
                  <select
                    id="quota-period"
                    value={period}
                    onChange={(e) => setPeriod(e.target.value as QuotaPeriod)}
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="day">Zilnic</option>
                    <option value="week">Saptamanal</option>
                    <option value="month">Lunar</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground" htmlFor="quota-limit">
                    Limita ({limitUnitLabel(feature)})
                  </label>
                  <input
                    id="quota-limit"
                    type="number"
                    step={isCountFeature(feature) ? "1" : "0.001"}
                    min="0"
                    value={limitUsd}
                    onChange={(e) => setLimitUsd(e.target.value)}
                    placeholder={isCountFeature(feature) ? "ex: 50" : "ex: 25"}
                    disabled={unlimited}
                    className={cn(
                      "h-9 w-full rounded-md border border-input bg-background px-3 text-sm",
                      unlimited && "opacity-50"
                    )}
                  />
                </div>
                <Button type="submit" disabled={busyFeature !== null}>
                  <Plus className="h-4 w-4" />
                  Salveaza
                </Button>
                <label className="col-span-full flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={unlimited}
                    onChange={(e) => setUnlimited(e.target.checked)}
                    className="h-3.5 w-3.5"
                  />
                  <span>Nelimitat (limita NULL — pass-through fara cap)</span>
                </label>
              </form>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Feature</th>
                      <th className="px-3 py-2 font-semibold">Perioada</th>
                      <th className="px-3 py-2 font-semibold">Limita</th>
                      <th className="px-3 py-2 font-semibold">Actualizat</th>
                      <th className="px-3 py-2 font-semibold">De</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {overrides.length === 0 && !loading && (
                      <tr>
                        <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                          Nu exista override-uri. Userul foloseste limita default.
                        </td>
                      </tr>
                    )}
                    {overrides.map((row) => (
                      <tr key={row.feature} className="border-b border-border last:border-b-0 hover:bg-muted/30">
                        <td className="px-3 py-2 align-top font-mono text-xs">{row.feature}</td>
                        <td className="px-3 py-2 align-top text-xs">{PERIOD_LABELS[row.period]}</td>
                        <td className="px-3 py-2 align-top">
                          {row.limitUsdMilli === null ? (
                            <Badge variant="outline">Nelimitat</Badge>
                          ) : isCountFeature(row.feature) ? (
                            <span className="font-mono">
                              {row.limitUsdMilli} {limitUnitLabel(row.feature)}
                            </span>
                          ) : (
                            <span className="font-mono">${formatStoredValue(row.feature, row.limitUsdMilli)}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                          {formatIsoDateTime(row.updatedAt)}
                        </td>
                        <td className="px-3 py-2 align-top font-mono text-xs">{row.updatedBy ?? "-"}</td>
                        <td className="px-3 py-2 align-top text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => startEdit(row)}
                              disabled={busyFeature === row.feature}
                            >
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

import { useCallback, useEffect, useState } from "react";
import { Gauge, RefreshCw, Trash2, Plus, ShieldAlert, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { UserPicker } from "@/components/UserPicker";
import { admin, type AdminUser, type GlobalQuotaOverride, type QuotaOverride, type QuotaPeriod } from "@/lib/api";
import { formatIsoDateTime } from "@/lib/datetime-formatters";
import {
  QUOTA_FEATURES,
  isCountFeature,
  isKnownQuotaFeature,
  quotaFeatureLabel,
  quotaLimitUnitLabel,
} from "@/lib/quotaFeatureLabels";
import { userRoleLabel, userStatusLabel } from "@/lib/userLabels";
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

function limitCellContent(feature: string, limitUsdMilli: number | null) {
  if (limitUsdMilli === null) return <Badge variant="outline">Nelimitat</Badge>;
  if (isCountFeature(feature)) {
    return (
      <span className="font-mono">
        {limitUsdMilli} {quotaLimitUnitLabel(feature)}
      </span>
    );
  }
  return <span className="font-mono">${formatStoredValue(feature, limitUsdMilli)}</span>;
}

export default function AdminQuota() {
  const confirm = useConfirm();
  const [globalRows, setGlobalRows] = useState<GlobalQuotaOverride[]>([]);
  const [globalTruncated, setGlobalTruncated] = useState(false);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [overrides, setOverrides] = useState<QuotaOverride[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feature, setFeature] = useState<string>(QUOTA_FEATURES[0]);
  // Feature legacy (in afara enum-ului) incarcat prin "Editeaza": ramane
  // selectabil doar cat e valoarea curenta; salvarea e blocata cu motiv vizibil.
  const [legacyFeature, setLegacyFeature] = useState<string | null>(null);
  const [period, setPeriod] = useState<QuotaPeriod>("day");
  const [limitInput, setLimitInput] = useState("");
  const [busyFeature, setBusyFeature] = useState<string | null>(null);

  const loadGlobal = useCallback(async () => {
    setGlobalLoading(true);
    try {
      const result = await admin.listAllQuotaOverrides();
      setGlobalRows(result.overrides);
      setGlobalTruncated(result.truncated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la incarcarea vederii globale.");
    } finally {
      setGlobalLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGlobal();
  }, [loadGlobal]);

  // Fetch-ul per-user traieste in efect cu AbortController + guards (pattern
  // 6.7): golirea sincrona a listei NU anuleaza un fetch in zbor — un raspuns
  // lent pentru userul A ar ateriza dupa selectarea lui B si ar afisa (si
  // permite stergerea) plafoanelor lui A sub identitatea lui B (finding
  // review-panel confirmat). refreshTick = reincarcare manuala/post-mutatie.
  const [refreshTick, setRefreshTick] = useState(0);
  const refreshOverrides = useCallback(() => setRefreshTick((t) => t + 1), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshTick este trigger explicit de reincarcare (pattern 6.7), nu e citit in corp.
  useEffect(() => {
    setOverrides([]);
    if (!selected) return;
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    admin
      .listQuota(selected.id, ac.signal)
      .then((result) => {
        if (ac.signal.aborted) return;
        setOverrides(result.overrides);
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Eroare la incarcarea cotelor.");
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [selected, refreshTick]);

  const resetForm = () => {
    setFeature(QUOTA_FEATURES[0]);
    setLegacyFeature(null);
    setPeriod("day");
    setLimitInput("");
  };

  const onSelectUser = (user: AdminUser) => {
    setSelected(user);
    resetForm();
  };

  // Din vederea globala: admin.getUser(id) + intrare in modul editare (5.5).
  const onEditFromGlobal = async (row: GlobalQuotaOverride) => {
    setError(null);
    try {
      const user = await admin.getUser(row.userId);
      setSelected(user);
      startEditValues(row.feature, row.period, row.limitUsdMilli);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la incarcarea utilizatorului.");
    }
  };

  const startEditValues = (rowFeature: string, rowPeriod: QuotaPeriod, limitUsdMilli: number | null) => {
    setFeature(rowFeature);
    setLegacyFeature(isKnownQuotaFeature(rowFeature) ? null : rowFeature);
    setPeriod(rowPeriod);
    // Fara checkbox "Nelimitat": randurile NULL se editeaza doar cu numar
    // (sau se sterg). Input-ul porneste gol.
    setLimitInput(limitUsdMilli === null ? "" : formatStoredValue(rowFeature, limitUsdMilli));
  };

  const featureIsLegacy = legacyFeature !== null && feature === legacyFeature;

  const onUpsert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    if (featureIsLegacy) return; // butonul e disabled; guard si aici
    const parsed = parseInputToStored(feature, limitInput);
    if (parsed === "invalid") {
      setError(
        isCountFeature(feature)
          ? "Introdu un numar intreg de captcha-uri (>= 0)."
          : "Introdu o limita valida in USD (>= 0)."
      );
      return;
    }
    setBusyFeature(feature);
    setError(null);
    try {
      await admin.upsertQuota(selected.id, { feature, period, limitUsdMilli: parsed });
      refreshOverrides();
      await loadGlobal();
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la salvarea cotei.");
    } finally {
      setBusyFeature(null);
    }
  };

  const onDelete = async (row: QuotaOverride) => {
    if (!selected) return;
    const limitLabel =
      row.limitUsdMilli === null
        ? "nelimitat"
        : isCountFeature(row.feature)
          ? `${row.limitUsdMilli} ${quotaLimitUnitLabel(row.feature)}`
          : `${formatStoredValue(row.feature, row.limitUsdMilli)} $`;
    const periodLabel = PERIOD_LABELS[row.period].toLowerCase();
    const ok = await confirm({
      title: "Sterge cota",
      message: `Sterge plafonul pentru "${quotaFeatureLabel(row.feature)}" (${limitLabel} / ${periodLabel})? Utilizatorul revine la limita default.`,
      destructive: true,
      confirmLabel: "Sterge",
    });
    if (!ok) return;
    setBusyFeature(row.feature);
    setError(null);
    try {
      await admin.deleteQuota(selected.id, row.feature);
      refreshOverrides();
      await loadGlobal();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la stergerea cotei.");
    } finally {
      setBusyFeature(null);
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
            Plafoane pe fereastra rulanta (zi / saptamana / luna). Pentru AI limita e in USD, pentru captcha e numar de
            rezolvari. Starea "nelimitat" = absenta plafonului: scoate plafonul stergand randul.
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
            <CardTitle className="flex items-center justify-between gap-2 text-base">
              <span className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                Toate plafoanele configurate
              </span>
              <Button variant="outline" size="sm" onClick={loadGlobal} disabled={globalLoading}>
                <RefreshCw className={cn("h-4 w-4", globalLoading && "animate-spin")} />
                Reincarca
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {globalTruncated && (
              <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                Lista e trunchiata la primele 500 de randuri.
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Utilizator</th>
                    <th className="px-3 py-2 font-semibold">Feature</th>
                    <th className="px-3 py-2 font-semibold">Perioada</th>
                    <th className="px-3 py-2 font-semibold">Limita</th>
                    <th className="px-3 py-2 font-semibold">Actualizat</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {globalRows.length === 0 && !globalLoading && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                        Nu exista plafoane configurate. Toti utilizatorii folosesc limita default.
                      </td>
                    </tr>
                  )}
                  {globalRows.map((row) => (
                    <tr
                      key={`${row.userId}:${row.feature}`}
                      className="border-b border-border last:border-b-0 hover:bg-muted/30"
                    >
                      <td className="px-3 py-2 align-top">
                        <p className="font-mono text-xs">{row.email}</p>
                        <p className="text-xs text-muted-foreground">
                          {row.displayName} · {userRoleLabel(row.role)} · {userStatusLabel(row.status)}
                        </p>
                      </td>
                      <td className="px-3 py-2 align-top text-xs">{quotaFeatureLabel(row.feature)}</td>
                      <td className="px-3 py-2 align-top text-xs">{PERIOD_LABELS[row.period]}</td>
                      <td className="px-3 py-2 align-top">{limitCellContent(row.feature, row.limitUsdMilli)}</td>
                      <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                        {formatIsoDateTime(row.updatedAt)}
                      </td>
                      <td className="px-3 py-2 align-top text-right">
                        <Button size="sm" variant="ghost" onClick={() => onEditFromGlobal(row)}>
                          Editeaza
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Seteaza plafon pentru un utilizator</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <UserPicker
              value={selected?.id ?? ""}
              onSelect={onSelectUser}
              ariaLabel="Alege utilizatorul pentru plafon"
            />

            {selected && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-sm">{selected.email}</span>
                    <Badge variant="outline">{userRoleLabel(selected.role)}</Badge>
                    <Badge variant={selected.status === "active" ? "success" : "warning"}>
                      {userStatusLabel(selected.status)}
                    </Badge>
                  </span>
                  <Button variant="outline" size="sm" onClick={refreshOverrides} disabled={loading}>
                    <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                    Reincarca
                  </Button>
                </div>

                {/* Limita = 1fr (absoarbe spatiul liber); coloana butonului
                    ramane auto si se strange pe continut — altfel butonul
                    Salveaza se intindea pe tot restul randului. */}
                <form onSubmit={onUpsert} className="grid gap-3 md:grid-cols-[260px_140px_1fr_auto] md:items-end">
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground" htmlFor="quota-feature">
                      Feature
                    </label>
                    <select
                      id="quota-feature"
                      value={feature}
                      onChange={(e) => setFeature(e.target.value)}
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    >
                      {QUOTA_FEATURES.map((f) => (
                        <option key={f} value={f}>
                          {quotaFeatureLabel(f)}
                        </option>
                      ))}
                      {legacyFeature !== null && <option value={legacyFeature}>{legacyFeature} (vechi)</option>}
                    </select>
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
                      Limita ({quotaLimitUnitLabel(feature)})
                    </label>
                    <input
                      id="quota-limit"
                      type="number"
                      step={isCountFeature(feature) ? "1" : "0.001"}
                      min="0"
                      value={limitInput}
                      onChange={(e) => setLimitInput(e.target.value)}
                      placeholder={isCountFeature(feature) ? "ex: 50" : "ex: 25"}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    />
                  </div>
                  <Button type="submit" disabled={busyFeature !== null || featureIsLegacy}>
                    <Plus className="h-4 w-4" />
                    Salveaza
                  </Button>
                  {featureIsLegacy && (
                    <p className="col-span-full text-xs text-amber-700 dark:text-amber-400">
                      "{legacyFeature}" este un feature vechi care nu mai poate fi salvat. Poti doar sterge randul
                      existent; pentru un plafon nou alege un feature din lista.
                    </p>
                  )}
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
                            Nu exista plafoane. Utilizatorul foloseste limita default.
                          </td>
                        </tr>
                      )}
                      {overrides.map((row) => (
                        <tr key={row.feature} className="border-b border-border last:border-b-0 hover:bg-muted/30">
                          <td className="px-3 py-2 align-top text-xs">{quotaFeatureLabel(row.feature)}</td>
                          <td className="px-3 py-2 align-top text-xs">{PERIOD_LABELS[row.period]}</td>
                          <td className="px-3 py-2 align-top">{limitCellContent(row.feature, row.limitUsdMilli)}</td>
                          <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                            {formatIsoDateTime(row.updatedAt)}
                          </td>
                          <td className="px-3 py-2 align-top font-mono text-xs">{row.updatedBy ?? "-"}</td>
                          <td className="px-3 py-2 align-top text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => startEditValues(row.feature, row.period, row.limitUsdMilli)}
                                disabled={busyFeature === row.feature}
                              >
                                Editeaza
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => onDelete(row)}
                                disabled={busyFeature === row.feature}
                                aria-label={`Sterge plafonul ${quotaFeatureLabel(row.feature)}`}
                                title="Sterge plafonul"
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
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

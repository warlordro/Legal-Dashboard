import { useCallback, useEffect, useState } from "react";
import { Gauge, RefreshCw, Trash2, Plus, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
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

const DEFAULT_FEATURE = QUOTA_FEATURES[0];

export default function AdminQuota({ embedded = false }: { embedded?: boolean } = {}) {
  const confirm = useConfirm();
  const toast = useToast();
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [overrides, setOverrides] = useState<QuotaOverride[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feature, setFeature] = useState<string>(DEFAULT_FEATURE);
  const [period, setPeriod] = useState<QuotaPeriod>("day");
  const [limitInput, setLimitInput] = useState("");
  const [busyFeature, setBusyFeature] = useState<string | null>(null);
  // v2.41.0: vedere globala la deschidere — cotele active ale tuturor userilor,
  // fara sa fie nevoie de cautarea prealabila a unui user.
  const [overview, setOverview] = useState<GlobalQuotaOverride[]>([]);
  const [overviewTruncated, setOverviewTruncated] = useState(false);
  const [overviewLoading, setOverviewLoading] = useState(false);

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    try {
      const result = await admin.listAllQuotaOverrides();
      setOverview(result.overrides);
      setOverviewTruncated(result.truncated === true);
      // Fara clear, un banner de eroare de la un load esuat anterior persista
      // si dupa un refresh reusit.
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la incarcarea cotelor active.");
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

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

  const onSelect = (user: AdminUser) => {
    setSelected(user);
    setFeature(DEFAULT_FEATURE);
    setPeriod("day");
    setLimitInput("");
  };

  const startEdit = (override: Pick<QuotaOverride, "feature" | "period" | "limitUsdMilli">) => {
    setFeature(override.feature);
    setPeriod(override.period);
    // Rand legacy nelimitat (override NULL): campul porneste gol — salvarea
    // cere un numar; revenirea la nelimitat se face cu Sterge.
    setLimitInput(override.limitUsdMilli === null ? "" : formatStoredValue(override.feature, override.limitUsdMilli));
  };

  // Din vederea globala: admin.getUser(id) + intrare in modul editare (5.5,
  // extra pastrat fata de referinta: formularul se pre-populeaza cu valorile
  // randului, nu porneste gol).
  const selectFromOverview = async (row: GlobalQuotaOverride) => {
    setError(null);
    try {
      const user = await admin.getUser(row.userId);
      setSelected(user);
      startEdit(row);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la incarcarea utilizatorului.");
    }
  };

  const onUpsert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    if (!isKnownQuotaFeature(feature)) return; // butonul e disabled; guard si aici
    // Fara checkbox "Nelimitat" — starea nelimitata e absenta limitei (sterge
    // randul din lista), nu un override explicit NULL.
    const parsed = parseInputToStored(feature, limitInput);
    if (parsed === "invalid") {
      setError(isCountFeature(feature) ? "Introdu un numar intreg >= 0." : "Introdu o limita valida (>= 0).");
      return;
    }
    setBusyFeature(feature);
    setError(null);
    try {
      await admin.upsertQuota(selected.id, { feature, period, limitUsdMilli: parsed });
      refreshOverrides();
      void loadOverview();
      setFeature(DEFAULT_FEATURE);
      setLimitInput("");
      setPeriod("day");
      toast(`Limita pentru "${quotaFeatureLabel(feature)}" a fost salvata.`, { variant: "success" });
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
          ? `${override.limitUsdMilli} ${quotaLimitUnitLabel(override.feature)}`
          : `${formatStoredValue(override.feature, override.limitUsdMilli)} $`;
    const periodLabel = PERIOD_LABELS[override.period].toLowerCase();
    const ok = await confirm({
      title: "Sterge cota",
      message: `Sterge limita pentru "${quotaFeatureLabel(override.feature)}" (${limitLabel} / ${periodLabel})? Userul revine la buget nelimitat.`,
      destructive: true,
      confirmLabel: "Sterge",
    });
    if (!ok) return;
    setBusyFeature(override.feature);
    setError(null);
    try {
      await admin.deleteQuota(selected.id, override.feature);
      refreshOverrides();
      void loadOverview();
      toast(`Limita pentru "${quotaFeatureLabel(override.feature)}" a fost stearsa — buget nelimitat.`, {
        variant: "success",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la stergerea cotei.");
    } finally {
      setBusyFeature(null);
    }
  };

  return (
    <div className={cn(!embedded && "min-h-full bg-background p-6")}>
      <div className={cn("space-y-5", !embedded && "mx-auto max-w-5xl")}>
        <div>
          {!embedded && (
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <Gauge className="h-6 w-6 text-primary" />
              Cote utilizatori
            </h1>
          )}
          <p className={cn("text-sm text-muted-foreground", !embedded && "mt-1")}>
            Limitele de cheltuiala per utilizator, pe fereastra rulanta (zi / saptamana / luna): pentru analizele AI
            limita e cost in USD, pentru Captcha RNPM e numar de captcha-uri. Un user fara limita setata are buget
            nelimitat; ca sa scoti un plafon existent, sterge-l din lista.
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

        <UserPicker value={selected?.id ?? ""} onSelect={onSelect} ariaLabel="Alege utilizatorul pentru plafon" />

        {!selected && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                <span className="flex items-center gap-2">
                  <Gauge className="h-4 w-4" />
                  Cote active
                </span>
                <Button variant="outline" size="sm" onClick={() => loadOverview()} disabled={overviewLoading}>
                  <RefreshCw className={cn("h-4 w-4", overviewLoading && "animate-spin")} />
                  Reincarca
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {overview.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  {overviewLoading
                    ? "Se incarca cotele active..."
                    : "Nicio limita setata — toti userii au buget NELIMITAT (AI si captcha). " +
                      "Ca sa plafonezi costurile unui user, cauta-l mai sus si seteaza-i o limita pe feature."}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2 font-semibold">Utilizator</th>
                        <th className="px-3 py-2 font-semibold">Feature</th>
                        <th className="px-3 py-2 font-semibold">Perioada</th>
                        <th className="px-3 py-2 font-semibold">Limita</th>
                        <th className="px-3 py-2 font-semibold">Actualizat</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {overview.map((row) => (
                        <tr key={`${row.userId}:${row.feature}`}>
                          <td className="px-3 py-2 align-top">
                            <p className="font-mono text-xs">{row.email}</p>
                            {row.displayName && <p className="text-xs text-muted-foreground">{row.displayName}</p>}
                          </td>
                          <td className="px-3 py-2 align-top">{quotaFeatureLabel(row.feature)}</td>
                          <td className="px-3 py-2 align-top">{PERIOD_LABELS[row.period]}</td>
                          <td className="px-3 py-2 align-top">
                            {row.limitUsdMilli === null
                              ? "Nelimitat"
                              : `${formatStoredValue(row.feature, row.limitUsdMilli)} ${quotaLimitUnitLabel(row.feature)}`}
                          </td>
                          <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                            {formatIsoDateTime(row.updatedAt)}
                          </td>
                          <td className="px-3 py-2 align-top text-right">
                            <Button size="sm" variant="outline" onClick={() => selectFromOverview(row)}>
                              Editeaza
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {overviewTruncated && (
                    <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                      Lista arata primele 500 de limite — exista mai multe; cauta userul direct pentru restul.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {selected && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                <span className="flex items-center gap-2">
                  <span className="font-mono text-sm">{selected.email}</span>
                  <Badge variant="outline">{userRoleLabel(selected.role)}</Badge>
                  <Badge variant={selected.status === "active" ? "success" : "warning"}>
                    {userStatusLabel(selected.status)}
                  </Badge>
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={refreshOverrides} disabled={loading}>
                    <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                    Reincarca
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
                  <select
                    id="quota-feature"
                    value={feature}
                    onChange={(e) => setFeature(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {/* Rand legacy (feature in afara enum-ului, ex. pre-consolidare): il
                        pastram selectabil doar cat e valoarea curenta (edit round-trip
                        corect), fara sa-l oferim ca optiune noua. */}
                    {feature && !isKnownQuotaFeature(feature) && (
                      <option value={feature} disabled>
                        {quotaFeatureLabel(feature)}
                      </option>
                    )}
                    {QUOTA_FEATURES.map((f) => (
                      <option key={f} value={f}>
                        {quotaFeatureLabel(f)}
                      </option>
                    ))}
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
                <Button
                  type="submit"
                  disabled={busyFeature !== null || !isKnownQuotaFeature(feature)}
                  title={
                    !isKnownQuotaFeature(feature)
                      ? "Feature legacy in afara enum-ului — backend-ul l-ar respinge; poate fi doar sters."
                      : undefined
                  }
                >
                  <Plus className="h-4 w-4" />
                  Salveaza
                </Button>
                {/* Randuri full-width sub grid — helper text-ul NU sta in coloana
                    Feature: cu items-end, inaltimea extra ar defaza selectul fata
                    de restul campurilor. */}
                <p className="col-span-full text-xs text-muted-foreground">
                  {isCountFeature(feature)
                    ? "Limita = numar de captcha-uri pe fereastra aleasa."
                    : "Limita = cost in USD pe fereastra aleasa."}
                </p>
                {!isKnownQuotaFeature(feature) && (
                  <p className="col-span-full text-xs text-amber-700 dark:text-amber-400">
                    Feature vechi ("{quotaFeatureLabel(feature)}") — nu mai poate fi salvat; limita lui poate fi doar
                    stearsa din lista de mai jos.
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
                          Nicio limita setata pentru acest user — buget nelimitat. Seteaza una cu formularul de mai sus.
                        </td>
                      </tr>
                    )}
                    {overrides.map((row) => (
                      <tr key={row.feature} className="border-b border-border last:border-b-0 hover:bg-muted/30">
                        <td className="px-3 py-2 align-top text-xs">{quotaFeatureLabel(row.feature)}</td>
                        <td className="px-3 py-2 align-top text-xs">{PERIOD_LABELS[row.period]}</td>
                        <td className="px-3 py-2 align-top">
                          {row.limitUsdMilli === null ? (
                            <Badge variant="outline">Nelimitat</Badge>
                          ) : isCountFeature(row.feature) ? (
                            <span className="font-mono">
                              {row.limitUsdMilli} {quotaLimitUnitLabel(row.feature)}
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
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

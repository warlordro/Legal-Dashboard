import { useCallback, useEffect, useState } from "react";
import { Gauge, RefreshCw, Trash2, Plus, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { UserPicker } from "@/components/admin/UserPicker";
import { admin, type AdminUser, type QuotaOverride, type QuotaOverrideWithUser, type QuotaPeriod } from "@/lib/api";
import { formatIsoDateTime } from "@/lib/datetime-formatters";
import { quotaFeatureLabel } from "@/lib/quotaFeatureLabels";
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

// Oglinda QUOTA_FEATURES din backend (quotaGuard.ts) — enum inchis, validat cu
// z.enum in admin.ts. v2.42.0: limita AI e UNICA (pool peste analizele single
// si multi-agent — decizie user); captcha ramane separat (alta unitate).
// Etichetele vin din vocabularul partajat (CodeRabbit: era duplicat cu Grants).
const FEATURE_OPTIONS = (["ai", "captcha.rnpm"] as const).map((value) => ({
  value,
  label: quotaFeatureLabel(value),
}));
const DEFAULT_FEATURE = FEATURE_OPTIONS[0].value;

function isKnownFeature(feature: string): boolean {
  return FEATURE_OPTIONS.some((o) => o.value === feature);
}

const featureLabel = quotaFeatureLabel;

export default function AdminQuota({ embedded = false }: { embedded?: boolean } = {}) {
  const confirm = useConfirm();
  const toast = useToast();
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [overrides, setOverrides] = useState<QuotaOverride[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feature, setFeature] = useState<string>(DEFAULT_FEATURE);
  const [period, setPeriod] = useState<QuotaPeriod>("day");
  const [limitUsd, setLimitUsd] = useState("");
  const [busyFeature, setBusyFeature] = useState<string | null>(null);
  // v2.41.0: vedere globala la deschidere — cotele active ale tuturor userilor,
  // fara sa fie nevoie de cautarea prealabila a unui user.
  const [overview, setOverview] = useState<QuotaOverrideWithUser[]>([]);
  const [overviewTruncated, setOverviewTruncated] = useState(false);
  const [overviewLoading, setOverviewLoading] = useState(false);

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    try {
      const result = await admin.listQuotaOverview();
      setOverview(result.overrides);
      setOverviewTruncated(result.truncated === true);
      // CodeRabbit (confirmat): fara clear, un banner de eroare de la un load
      // esuat anterior persista si dupa un refresh reusit.
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

  const selectFromOverview = async (userId: string) => {
    try {
      const user = await admin.getUser(userId);
      onSelect(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la incarcarea utilizatorului.");
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
    setFeature(DEFAULT_FEATURE);
    setPeriod("day");
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
    // v2.42.0 (feedback user): fara checkbox "Nelimitat" — starea nelimitata e
    // absenta limitei (sterge randul din lista), nu un override explicit NULL.
    const parsed = parseInputToStored(featureKey, limitUsd);
    if (parsed === "invalid") {
      const hint = isCountFeature(featureKey) ? "Introdu un numar intreg >= 0." : "Introdu o limita valida (>= 0).";
      setError(hint);
      return;
    }
    const limitUsdMilli = parsed;
    setBusyFeature(featureKey);
    setError(null);
    try {
      await admin.upsertQuota(selected.id, {
        feature: featureKey,
        period,
        limitUsdMilli,
      });
      await loadOverrides(selected.id);
      void loadOverview();
      setFeature(DEFAULT_FEATURE);
      setLimitUsd("");
      setPeriod("day");
      toast(`Limita pentru "${featureLabel(featureKey)}" a fost salvata.`, { variant: "success" });
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
      message: `Sterge limita pentru "${featureLabel(override.feature)}" (${limitLabel} / ${periodLabel})? Userul revine la buget nelimitat.`,
      destructive: true,
      confirmLabel: "Sterge",
    });
    if (!ok) return;
    setBusyFeature(override.feature);
    setError(null);
    try {
      await admin.deleteQuota(selected.id, override.feature);
      await loadOverrides(selected.id);
      void loadOverview();
      toast(`Limita pentru "${featureLabel(override.feature)}" a fost stearsa — buget nelimitat.`, {
        variant: "success",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la stergerea cotei.");
    } finally {
      setBusyFeature(null);
    }
  };

  const startEdit = (override: QuotaOverride) => {
    setFeature(override.feature);
    setPeriod(override.period);
    // Rand legacy nelimitat (override NULL): campul porneste gol — salvarea
    // cere un numar; revenirea la nelimitat se face cu Sterge.
    setLimitUsd(override.limitUsdMilli === null ? "" : formatStoredValue(override.feature, override.limitUsdMilli));
  };

  return (
    <div className={embedded ? "" : "min-h-full bg-background p-6"}>
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

        <UserPicker selectedId={selected?.id ?? null} onSelect={onSelect} />

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
                            <p className="font-mono text-xs">{row.userEmail ?? row.userId}</p>
                            {row.userDisplayName && (
                              <p className="text-xs text-muted-foreground">{row.userDisplayName}</p>
                            )}
                          </td>
                          <td className="px-3 py-2 align-top">
                            {FEATURE_OPTIONS.find((o) => o.value === row.feature)?.label ?? row.feature}
                          </td>
                          <td className="px-3 py-2 align-top">{PERIOD_LABELS[row.period]}</td>
                          <td className="px-3 py-2 align-top">
                            {row.limitUsdMilli === null
                              ? "Nelimitat"
                              : `${formatStoredValue(row.feature, row.limitUsdMilli)} ${limitUnitLabel(row.feature)}`}
                          </td>
                          <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                            {new Date(row.updatedAt).toLocaleString("ro-RO")}
                          </td>
                          <td className="px-3 py-2 align-top text-right">
                            <Button size="sm" variant="outline" onClick={() => selectFromOverview(row.userId)}>
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
                  <Button variant="outline" size="sm" onClick={() => loadOverrides(selected.id)} disabled={loading}>
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
                    {/* Rand legacy (feature in afara enum-ului, ex. pre-v2.32): il pastram
                        selectabil doar cat e valoarea curenta (edit round-trip corect),
                        fara sa-l oferim ca optiune noua. */}
                    {feature && !isKnownFeature(feature) && (
                      <option value={feature} disabled>
                        {feature} (legacy)
                      </option>
                    )}
                    {FEATURE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
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
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={busyFeature !== null || !isKnownFeature(feature)}
                  title={
                    !isKnownFeature(feature)
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
                {!isKnownFeature(feature) && (
                  // CodeRabbit (PR #65): motivul blocarii era doar in title-ul
                  // butonului disabled — invizibil in majoritatea browserelor.
                  <p className="col-span-full text-xs text-amber-700 dark:text-amber-400">
                    Feature vechi ("{feature}") — nu mai poate fi salvat; limita lui poate fi doar stearsa din lista de
                    mai jos.
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
                        <td className="px-3 py-2 align-top text-xs">{featureLabel(row.feature)}</td>
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

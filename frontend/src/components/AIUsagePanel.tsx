import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, BarChart3, Bot, Clock3, RefreshCw, Zap } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useTenantKeyStatus } from "@/hooks/useTenantKeyStatus";
import { aiUsageApi, type AiUsageDailyPoint, type AiUsageSummaryResult } from "@/lib/aiUsageApi";
import { me, type MeBudgetItem, type MeFxRate } from "@/lib/api";
import { CHART_FILLS } from "@/lib/chart-colors";
import { cn } from "@/lib/utils";

type LoadState = "loading" | "ready" | "error";

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

const numberFormatter = new Intl.NumberFormat("ro-RO");

function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "$0.00";
  return usdFormatter.format(value);
}

const eurFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

// Fail-closed pe EUR (acelasi pattern ca "Bugetul tau" din Usage.tsx): fara
// curs sau cu curs stale nu afisam o valoare numerica potential gresita.
function formatEur(usdValue: number, fx: MeFxRate | null): string {
  if (!fx || fx.rate === null || fx.stale || !Number.isFinite(usdValue)) return "EUR indisponibil";
  return eurFormatter.format(usdValue * fx.rate);
}

// Backend buckets days at UTC midnight (`substr(ts, 1, 10)`), so the label
// must read the date as UTC. Parsing `YYYY-MM-DDT00:00:00` without a `Z`
// would treat it as local time and shift the label by one day west of UTC
// for users east of UTC (or vice versa).
function formatDateLabel(value: string): string {
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("ro-RO", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
}

function totalTokens(point: Pick<AiUsageDailyPoint, "inputTokens" | "outputTokens">): number {
  return point.inputTokens + point.outputTokens;
}

function isUsageEmpty(data: AiUsageSummaryResult | null): boolean {
  if (!data) return true;
  const totalSummary =
    data.summary30d.costUsd + data.summary30d.calls + data.summary30d.inputTokens + data.summary30d.outputTokens;
  const totalDaily = data.daily.reduce(
    (sum, point) => sum + point.costUsd + point.calls + point.inputTokens + point.outputTokens,
    0
  );
  return totalSummary === 0 && totalDaily === 0;
}

function UsageTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload: AiUsageDailyPoint }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-foreground">{label ? formatDateLabel(label) : "Zi"}</p>
      <p className="text-muted-foreground">{formatUsd(point.costUsd)} cost</p>
      <p className="text-muted-foreground">{numberFormatter.format(point.calls)} apeluri</p>
      <p className="text-muted-foreground">{numberFormatter.format(totalTokens(point))} tokeni</p>
    </div>
  );
}

export function AIUsagePanel() {
  const [state, setState] = useState<LoadState>("loading");
  const [data, setData] = useState<AiUsageSummaryResult | null>(null);
  const [budget, setBudget] = useState<MeBudgetItem | null>(null);
  const [fx, setFx] = useState<MeFxRate | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Cardul de cota apare DOAR cand serverul e in web mode (quotaGuard
  // enforce-uieste doar acolo). Pe desktop guard-ul e bypass, deci cardul ar
  // fi redundant ("Nelimitata") sau fals ("Blocata" dintr-un override rezidual).
  const { tenantMode } = useTenantKeyStatus();
  // The active fetch's controller. Refresh and unmount both abort it so an
  // in-flight summary cannot land after a newer request started or after the
  // panel went away (which would otherwise call setState on an unmounted tree).
  const inflightRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    inflightRef.current?.abort();
    const controller = new AbortController();
    inflightRef.current = controller;
    setState("loading");
    setError(null);
    try {
      // Bugetul (cota alocata) e informativ si nu trebuie sa strice panoul de
      // costuri daca /me/budget pica — de aceea allSettled, nu Promise.all.
      const [summaryResult, budgetResult] = await Promise.allSettled([
        aiUsageApi.summary(controller.signal),
        me.budget(controller.signal),
      ]);
      if (controller.signal.aborted) return;
      if (summaryResult.status === "rejected") throw summaryResult.reason;
      setData(summaryResult.value);
      setBudget(
        budgetResult.status === "fulfilled"
          ? (budgetResult.value.items.find((item) => item.feature === "ai") ?? null)
          : null
      );
      setFx(budgetResult.status === "fulfilled" ? budgetResult.value.fx : null);
      setState("ready");
    } catch (err) {
      if (controller.signal.aborted) return;
      setData(null);
      setBudget(null);
      setFx(null);
      setError(err instanceof Error ? err.message : "Eroare la incarcarea usage-ului AI.");
      setState("error");
    } finally {
      if (inflightRef.current === controller) {
        inflightRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    load();
    return () => {
      inflightRef.current?.abort();
      inflightRef.current = null;
    };
  }, [load]);

  const chartData = useMemo(() => {
    return [...(data?.daily ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  }, [data]);

  const recentRows = useMemo(() => {
    return [...chartData].reverse().slice(0, 5);
  }, [chartData]);

  const empty = state === "ready" && isUsageEmpty(data);

  return (
    <section className="mb-3 rounded-lg border border-border bg-background/40 p-3">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="flex items-center gap-2 text-sm font-semibold">
            <Bot className="h-4 w-4 text-sky-500" />
            AI Usage
          </h4>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Costuri si volum pentru apelurile AI inregistrate pe userul curent.
          </p>
          <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
            Informativ. Pe desktop nu exista quota enforce — costurile efective sunt facturate de provider.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => load()}
          disabled={state === "loading"}
          className="h-8"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", state === "loading" && "animate-spin")} />
          Actualizeaza
        </Button>
      </div>

      {state === "loading" && (
        <div className="flex min-h-44 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
          <Spinner className="mr-2 h-4 w-4" />
          Se incarca usage-ul AI...
        </div>
      )}

      {state === "ready" && tenantMode && <QuotaCard budget={budget} fx={fx} />}

      {state === "error" && (
        <div className="flex min-h-32 items-start gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium">Usage AI indisponibil</p>
            <p className="mt-1 break-words text-xs">{error}</p>
          </div>
        </div>
      )}

      {empty && (
        <div className="flex min-h-32 items-center justify-center rounded-md border border-dashed border-border px-3 text-center text-sm text-muted-foreground">
          Nu exista apeluri AI inregistrate in ultimele 30 de zile.
        </div>
      )}

      {state === "ready" && data && !empty && (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <MetricTile
              icon={Clock3}
              label="Cost ultimele 24h"
              value={formatUsd(data.summary24h.costUsd)}
              detail={`${numberFormatter.format(data.summary24h.calls)} apeluri`}
              tone="sky"
            />
            <MetricTile
              icon={BarChart3}
              label="Cost ultimele 30 zile"
              value={formatUsd(data.summary30d.costUsd)}
              detail={`${numberFormatter.format(data.summary30d.calls)} apeluri`}
              tone="emerald"
            />
          </div>

          <div className="rounded-lg border border-border bg-card p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h5 className="flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground">
                <BarChart3 className="h-3.5 w-3.5" />
                Ultimele 30 zile
              </h5>
              <span className="text-[11px] text-muted-foreground">
                {numberFormatter.format(data.summary30d.inputTokens + data.summary30d.outputTokens)} tokeni
              </span>
            </div>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={chartData} margin={{ top: 5, right: 6, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="aiUsageCost" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_FILLS.aiUsage} stopOpacity={0.35} />
                      <stop offset="95%" stopColor={CHART_FILLS.aiUsage} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatDateLabel}
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={14}
                  />
                  <YAxis
                    tickFormatter={(value) => `$${Number(value).toFixed(2)}`}
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                    width={42}
                  />
                  <Tooltip content={<UsageTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="costUsd"
                    stroke={CHART_FILLS.aiUsage}
                    strokeWidth={2}
                    fill="url(#aiUsageCost)"
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[180px] items-center justify-center text-sm text-muted-foreground">
                Nu exista serie zilnica pentru grafic.
              </div>
            )}
          </div>

          <div className="grid gap-2 md:grid-cols-[1fr_1.1fr]">
            <div className="rounded-lg border border-border p-3">
              <h5 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground">
                <Zap className="h-3.5 w-3.5" />
                Metrici 30 zile
              </h5>
              <MetricRow label="Tokeni input" value={numberFormatter.format(data.summary30d.inputTokens)} />
              <MetricRow label="Tokeni output" value={numberFormatter.format(data.summary30d.outputTokens)} />
              <MetricRow
                label="Cost mediu / apel"
                value={formatUsd(data.summary30d.calls > 0 ? data.summary30d.costUsd / data.summary30d.calls : 0)}
              />
            </div>

            <div className="rounded-lg border border-border p-3">
              <h5 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Zile recente</h5>
              {recentRows.length > 0 ? (
                <div className="space-y-2">
                  {recentRows.map((row) => (
                    <div key={row.date} className="flex items-center justify-between gap-3 text-xs">
                      <span className="text-muted-foreground">{formatDateLabel(row.date)}</span>
                      <span className="min-w-0 flex-1 truncate text-right">
                        {numberFormatter.format(row.calls)} apeluri
                      </span>
                      <span className="w-20 text-right font-medium">{formatUsd(row.costUsd)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Fara intrari zilnice.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function MetricTile({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  detail: string;
  tone: "sky" | "emerald";
}) {
  const toneClass =
    tone === "sky"
      ? "bg-sky-500/10 text-sky-600 dark:text-sky-400"
      : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
      <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", toneClass)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-lg font-bold">{value}</p>
        <p className="text-[11px] text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border py-2 first:border-t-0 first:pt-0 last:pb-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

const PERIOD_RO: Record<MeBudgetItem["period"], string> = {
  day: "in ultimele 24h",
  week: "saptamanal",
  month: "lunar",
};

// v2.42.0 (Task 15): cota alocata + consumul curent, aliniate 1:1 cu
// /me/budget (aceeasi regula ca guard-ul de enforcement). Randat mereu cand
// state === "ready" (chiar si fara apeluri AI inregistrate) — un user cu
// cota alocata si zero consum tot trebuie sa-si vada cota.
function QuotaCard({ budget, fx }: { budget: MeBudgetItem | null; fx: MeFxRate | null }) {
  if (!budget) return null;
  const limit = budget.effectiveLimitMilli;
  const unlimited = limit === null;
  // Limita 0 (cota epuizata / blocata) nu e "0% consumat" — e blocaj total.
  const blocked = limit !== null && limit <= 0;
  // rawPct = procentul REAL, poate depasi 100% (overshoot multi-agent, vezi
  // quotaGuard.ts). Textul afiseaza rawPct; DOAR bara e clamp-uita la 100%.
  const rawPct = unlimited || blocked ? 0 : Math.max(0, (budget.usedMilli / limit) * 100);
  const barPct = Math.min(100, rawPct);
  const tone = blocked || rawPct >= 90 ? "red" : rawPct >= 75 ? "amber" : "emerald";
  const badgeToneClass =
    tone === "red"
      ? "bg-red-500/10 text-red-600 dark:text-red-400"
      : tone === "amber"
        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
        : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  const barToneClass = tone === "red" ? "bg-red-500" : tone === "amber" ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div className="mb-3 rounded-lg border border-border bg-card p-3">
      {/* Un singur rand (pattern-ul "Bugetul tau" din Usage.tsx): eticheta in
          stanga, sumele USD + echivalent EUR + badge-ul de procent in dreapta. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h5 className="text-xs font-semibold uppercase text-muted-foreground">
          Cota AI &middot; {PERIOD_RO[budget.period]}
        </h5>
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm">
            {formatUsd(budget.usedMilli / 1000)}
            <span className="text-muted-foreground"> ({formatEur(budget.usedMilli / 1000, fx)})</span>
            {!unlimited && (
              <span className="text-muted-foreground">
                {" "}
                / {formatUsd((limit ?? 0) / 1000)} ({formatEur((limit ?? 0) / 1000, fx)})
              </span>
            )}
          </span>
          <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", badgeToneClass)}>
            {unlimited ? "Nelimitata" : blocked ? "Blocata — cota epuizata" : `${Math.round(rawPct)}% consumat`}
          </span>
        </span>
      </div>
      {!unlimited && (
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
          <div className={cn("h-full transition-all", barToneClass)} style={{ width: `${blocked ? 100 : barPct}%` }} />
        </div>
      )}
    </div>
  );
}

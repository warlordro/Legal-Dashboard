// PR-B (v2.8.0) — Charts pentru pagina Dashboard.
//
// Trei serii zilnice aliniate pe acelasi grid (UTC-day) pentru fereastra
// 7d sau 30d:
//   - alerts.count       (bar amber)
//   - runs.{ok,error,timeout,aborted}  (stacked bar)
//   - aiCost.{costUsd,calls,tokens}    (area cost)
//
// Endpoint backend: GET /api/v1/dashboard/charts?range=7d|30d
// Reuses CHART_FILLS din chart-colors.ts. Acelasi pattern de tooltip si
// formatare ca AIUsagePanel ca sa nu existe doua "stiluri de chart" diferite
// pe aplicatie.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, BarChart3, Loader2, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CHART_FILLS } from "@/lib/chart-colors";
import { cn } from "@/lib/utils";
import {
  dashboardApi,
  MonitoringApiError,
  type ChartsAlertsPoint,
  type ChartsAiPoint,
  type ChartsPayload,
  type ChartsRange,
  type ChartsRunsPoint,
} from "@/lib/api";

const RANGE_OPTIONS: Array<{ value: ChartsRange; label: string }> = [
  { value: "7d", label: "7 zile" },
  { value: "30d", label: "30 zile" },
];

const numberFormatter = new Intl.NumberFormat("ro-RO");

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

function formatDateLabel(value: string): string {
  // Same UTC-anchored parse as AIUsagePanel — backend buckets at substr(ts,1,10)
  // (UTC midnight), so a `Z`-suffixed parse keeps the label aligned regardless
  // of the user's timezone.
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("ro-RO", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "$0.00";
  return usdFormatter.format(value);
}

function isEmpty(payload: ChartsPayload | null): boolean {
  if (!payload) return true;
  const totalAlerts = payload.series.alerts.reduce((s, p) => s + p.count, 0);
  const totalRuns = payload.series.runs.reduce((s, p) => s + p.total, 0);
  const totalCost = payload.series.aiCost.reduce((s, p) => s + p.costUsd, 0);
  return totalAlerts === 0 && totalRuns === 0 && totalCost === 0;
}

function AlertsTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartsAlertsPoint }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-foreground">{label ? formatDateLabel(label) : ""}</p>
      <p className="text-muted-foreground">{numberFormatter.format(point.count)} alerte</p>
    </div>
  );
}

function RunsTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartsRunsPoint }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-foreground">{label ? formatDateLabel(label) : ""}</p>
      <p className="text-muted-foreground">{point.ok} ok</p>
      <p className="text-muted-foreground">{point.error} erori</p>
      <p className="text-muted-foreground">{point.timeout} timeout</p>
      <p className="text-muted-foreground">{point.aborted} oprite</p>
    </div>
  );
}

function CostTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartsAiPoint }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-foreground">{label ? formatDateLabel(label) : ""}</p>
      <p className="text-muted-foreground">{formatUsd(point.costUsd)} cost</p>
      <p className="text-muted-foreground">{numberFormatter.format(point.calls)} apeluri</p>
      <p className="text-muted-foreground">{numberFormatter.format(point.tokens)} tokens</p>
    </div>
  );
}

export function Charts() {
  const [range, setRange] = useState<ChartsRange>("7d");
  const [data, setData] = useState<ChartsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflightRef = useRef<AbortController | null>(null);

  const load = useCallback(async (r: ChartsRange) => {
    inflightRef.current?.abort();
    const controller = new AbortController();
    inflightRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const payload = await dashboardApi.charts({ range: r, signal: controller.signal });
      if (controller.signal.aborted) return;
      setData(payload);
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      const message = err instanceof MonitoringApiError ? err.message : "Eroare necunoscuta.";
      setError(message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(range);
    return () => {
      inflightRef.current?.abort();
    };
  }, [load, range]);

  const empty = !loading && !error && isEmpty(data);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
        <div>
          <CardTitle className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            <BarChart3 className="h-3.5 w-3.5" />
            Tendinte
          </CardTitle>
          <CardDescription className="text-xs">Alerte, rulari si cost AI agregate pe zile.</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-border bg-card p-0.5">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setRange(opt.value)}
                className={cn(
                  "rounded px-2 py-1 text-xs font-medium transition-colors",
                  range === opt.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/40"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void load(range)}
            disabled={loading}
            className="h-8 gap-2"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Actualizeaza
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>Nu am putut incarca tendintele: {error}</span>
          </div>
        )}
        {loading && !data && (
          <div className="flex min-h-44 items-center justify-center text-xs text-muted-foreground">
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            Se incarca tendintele...
          </div>
        )}
        {empty && (
          <div className="flex min-h-44 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
            Nu exista date pentru perioada selectata.
          </div>
        )}
        {data && !empty && (
          <div className="grid gap-3 lg:grid-cols-3">
            <ChartCard title="Alerte / zi" subtitle={`${data.series.alerts.reduce((s, p) => s + p.count, 0)} total`}>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={data.series.alerts} margin={{ top: 5, right: 6, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis
                    dataKey="day"
                    tickFormatter={formatDateLabel}
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={14}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                    width={28}
                  />
                  <Tooltip content={<AlertsTooltip />} />
                  <Bar dataKey="count" fill={CHART_FILLS.alerts} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Rulari / zi" subtitle={`${data.series.runs.reduce((s, p) => s + p.total, 0)} total`}>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={data.series.runs} margin={{ top: 5, right: 6, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis
                    dataKey="day"
                    tickFormatter={formatDateLabel}
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={14}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                    width={28}
                  />
                  <Tooltip content={<RunsTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 10 }} iconType="square" iconSize={8} />
                  <Bar dataKey="ok" stackId="r" name="ok" fill={CHART_FILLS.runOk} />
                  <Bar dataKey="error" stackId="r" name="erori" fill={CHART_FILLS.runError} />
                  <Bar dataKey="timeout" stackId="r" name="timeout" fill={CHART_FILLS.runTimeout} />
                  <Bar dataKey="aborted" stackId="r" name="oprite" fill={CHART_FILLS.runAborted} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Cost AI / zi" subtitle={formatUsd(data.series.aiCost.reduce((s, p) => s + p.costUsd, 0))}>
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={data.series.aiCost} margin={{ top: 5, right: 6, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="dashboardAiCost" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_FILLS.aiUsage} stopOpacity={0.35} />
                      <stop offset="95%" stopColor={CHART_FILLS.aiUsage} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis
                    dataKey="day"
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
                  <Tooltip content={<CostTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="costUsd"
                    stroke={CHART_FILLS.aiUsage}
                    strokeWidth={2}
                    fill="url(#dashboardAiCost)"
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h5 className="text-xs font-semibold uppercase text-muted-foreground">{title}</h5>
        {subtitle && <span className="text-[11px] text-muted-foreground">{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}

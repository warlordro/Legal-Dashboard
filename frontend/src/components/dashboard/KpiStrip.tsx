// PR-A (v2.7.0) — KPI strip pentru pagina Dashboard.
//
// 4 cards aliniate orizontal pe md+, stacked pe mobile:
//   - Joburi active (cu byKind tooltip)
//   - Alerte necitite (cu delta last24h ca subline)
//   - Rulari ultimele 24h (ok / error / timeout)
//   - Cost AI ultimele 24h (USD + token count)
//
// Datele vin din /api/v1/dashboard/summary (vezi dashboardApi din lib/api.ts).
// Componenta in sine NU face fetch — primeste `data` + `loading` + `error` ca
// props ca sa permita refresh-ul orchestrat de Dashboard (polling 30s + delta
// SSE pe alerts.unseen).

import { ListChecks, Bell, Activity, Sparkles, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { DashboardSummary } from "@/lib/api";

interface KpiStripProps {
  data: DashboardSummary | null;
  loading: boolean;
  error: string | null;
}

interface KpiCardProps {
  icon: typeof ListChecks;
  label: string;
  value: string;
  subline?: string;
  tooltip?: string;
  iconColor: string;
  iconBg: string;
}

function KpiCard({ icon: Icon, label, value, subline, tooltip, iconColor, iconBg }: KpiCardProps) {
  return (
    <Card title={tooltip}>
      <CardContent className="pt-5">
        <div className="flex items-start gap-3">
          <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", iconBg)}>
            <Icon className={cn("h-4 w-4", iconColor)} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-bold leading-tight">{value}</p>
            {subline && <p className="mt-0.5 text-xs text-muted-foreground">{subline}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function formatUsd(value: number): string {
  // Sub-cent values still render meaningful precision; >$1 cents only.
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}

function formatTokens(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(2)}M`;
}

export function KpiStrip({ data, loading, error }: KpiStripProps) {
  if (error) {
    return (
      <Card>
        <CardContent className="pt-5">
          <p className="text-sm text-destructive">Nu am putut incarca rezumatul: {error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i}>
            <CardContent className="pt-5">
              <div className="flex items-center gap-3">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Se incarca…</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const jobsByKind = `${data.jobs.byKind.dosar_soap} dosar_soap, ${data.jobs.byKind.name_soap} name_soap`;
  const alertsSubline = data.alerts.last24h === 0
    ? "0 noi in ultimele 24h"
    : `+${data.alerts.last24h} noi in ultimele 24h`;
  const runsSubline = data.runs.total === 0
    ? "Nicio rulare in ultimele 24h"
    : `${data.runs.ok} ok / ${data.runs.error} erori / ${data.runs.timeout} timeout`;
  const aiSubline = data.ai.calls === 0
    ? "Niciun call in ultimele 24h"
    : `${data.ai.calls} call-uri, ${formatTokens(data.ai.tokens)} tokens`;

  return (
    <div
      aria-busy={loading || undefined}
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
    >
      <KpiCard
        icon={ListChecks}
        label="Joburi active"
        value={String(data.jobs.active)}
        subline={jobsByKind}
        tooltip={`${data.jobs.active} joburi de monitorizare active (${jobsByKind})`}
        iconColor="text-blue-500"
        iconBg="bg-blue-500/10"
      />
      <KpiCard
        icon={Bell}
        label="Alerte necitite"
        value={String(data.alerts.unseen)}
        subline={alertsSubline}
        iconColor="text-amber-500"
        iconBg="bg-amber-500/10"
      />
      <KpiCard
        icon={Activity}
        label="Rulari 24h"
        value={String(data.runs.total)}
        subline={runsSubline}
        iconColor="text-green-500"
        iconBg="bg-green-500/10"
      />
      <KpiCard
        icon={Sparkles}
        label="Cost AI 24h"
        value={formatUsd(data.ai.costUsd)}
        subline={aiSubline}
        iconColor="text-purple-500"
        iconBg="bg-purple-500/10"
      />
    </div>
  );
}

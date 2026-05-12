import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarDays, CalendarCheck, CalendarClock, BarChart3, ChevronDown, ChevronUp } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import type { Termen } from "@/types";
import { CHART_FILLS } from "@/lib/chart-colors";

export type MetricFilter = "viitoare" | "trecute" | "cuSolutie";

interface TermeneMetricsProps {
  termene: Termen[];
  activeFilters?: MetricFilter[];
  onFilterToggle?: (filter: MetricFilter) => void;
  onClearFilters?: () => void;
}

const MONTH_NAMES = ["Ian", "Feb", "Mar", "Apr", "Mai", "Iun", "Iul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function ChartTooltip({
  active,
  payload,
  label,
}: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-foreground">{label}</p>
      <p className="text-muted-foreground">{payload[0].value} termene</p>
    </div>
  );
}

export function TermeneMetrics({ termene, activeFilters = [], onFilterToggle, onClearFilters }: TermeneMetricsProps) {
  const [expanded, setExpanded] = useState(true);

  // Use start-of-day so a termen for today counts as "viitor" — keeps definition aligned
  // with filterByMetrics() in pages/Termene.tsx; otherwise the count and the filtered list diverge.
  const { viitoare, trecute, monthData } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let v = 0;
    let t = 0;
    const monthMap: Record<string, { key: string; label: string; value: number }> = {};
    for (const ter of termene) {
      const d = parseDate(ter.data);
      if (d && d >= today) {
        v++;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        if (!monthMap[key]) {
          monthMap[key] = {
            key,
            label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`,
            value: 0,
          };
        }
        monthMap[key].value++;
      } else {
        t++;
      }
    }
    const months = Object.values(monthMap)
      .sort((a, b) => a.key.localeCompare(b.key))
      .slice(0, 8);
    return { viitoare: v, trecute: t, monthData: months };
  }, [termene]);

  const solvedCount = useMemo(() => {
    return termene.filter((t) => t.solutie && t.solutie.trim() !== "").length;
  }, [termene]);

  return (
    <div className="space-y-4">
      {/* Header with toggle */}
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <BarChart3 className="h-4 w-4" />
          Metrici & Statistici
        </h2>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" />
              Ascunde
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" />
              Arata
            </>
          )}
        </button>
      </div>

      {/* Count cards - clickable filters */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <CountCard
          icon={CalendarDays}
          label="Total Termene"
          value={termene.length}
          color="text-primary"
          bg="bg-primary/10"
          onClick={activeFilters.length > 0 ? onClearFilters : undefined}
        />
        <CountCard
          icon={CalendarClock}
          label="Termene Viitoare"
          value={viitoare}
          color="text-green-500"
          bg="bg-green-500/10"
          active={activeFilters.includes("viitoare")}
          onClick={() => onFilterToggle?.("viitoare")}
        />
        <CountCard
          icon={CalendarCheck}
          label="Termene Trecute"
          value={trecute}
          color="text-amber-500"
          bg="bg-amber-500/10"
          active={activeFilters.includes("trecute")}
          onClick={() => onFilterToggle?.("trecute")}
        />
        <CountCard
          icon={BarChart3}
          label="Cu Solutie"
          value={solvedCount}
          color="text-blue-500"
          bg="bg-blue-500/10"
          active={activeFilters.includes("cuSolutie")}
          onClick={() => onFilterToggle?.("cuSolutie")}
        />
      </div>
      {activeFilters.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {activeFilters.length} {activeFilters.length === 1 ? "filtru activ" : "filtre active"} — click pentru a anula
        </p>
      )}

      {/* Collapsible chart */}
      {expanded && monthData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <BarChart3 className="h-4 w-4 text-primary" />
              Distributie Termene Viitoare pe Luni
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={monthData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="value" fill={CHART_FILLS.termene} radius={[4, 4, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function CountCard({
  icon: Icon,
  label,
  value,
  color,
  bg,
  active,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  color: string;
  bg: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <Card
      className={`p-4 transition-all ${onClick ? "cursor-pointer hover:shadow-md" : ""} ${
        active ? "ring-2 ring-primary border-primary bg-primary/5 shadow-sm" : ""
      }`}
      onClick={onClick}
    >
      <div className="flex items-center gap-3">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${active ? "bg-primary" : bg}`}>
          <Icon className={`h-4 w-4 ${active ? "text-primary-foreground" : color}`} />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-bold">{value}</p>
        </div>
      </div>
    </Card>
  );
}

function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

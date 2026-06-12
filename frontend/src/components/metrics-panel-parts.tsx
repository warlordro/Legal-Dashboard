import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, PieChart as PieChartIcon, Building2, Users } from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { CHART_FILLS } from "@/lib/chart-colors";

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; name?: string; payload?: { name: string } }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-foreground">{label || payload[0]?.payload?.name}</p>
      <p className="text-muted-foreground">{payload[0].value} dosare</p>
    </div>
  );
}

export function SummaryCard({
  icon: Icon,
  label,
  value,
  color,
  bg,
  detail,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  color: string;
  bg: string;
  detail?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${bg}`}>
          <Icon className={`h-4 w-4 ${color}`} />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-bold">{value}</p>
          {detail && <p className="truncate text-[11px] text-muted-foreground">{detail}</p>}
        </div>
      </div>
    </Card>
  );
}

export interface PartyAnalysisEntry {
  role: string;
  count: number;
}

export function PartyAnalysisCard({
  searchedName,
  entries,
  selectedRoles,
  onRoleFilter,
}: {
  searchedName: string;
  entries: PartyAnalysisEntry[];
  selectedRoles: string[];
  onRoleFilter?: (role: string) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Users className="h-4 w-4 text-primary" />
          Analiza Parte: &quot;{searchedName}&quot;
          {selectedRoles.length > 0 && (
            <span className="ml-1 text-[11px] font-normal text-muted-foreground">
              ({selectedRoles.length} {selectedRoles.length === 1 ? "filtru activ" : "filtre active"} — click pentru a
              anula)
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-3">
          {entries.map(({ role, count }) => {
            const isActive = selectedRoles.includes(role);
            return (
              <button
                key={role}
                type="button"
                onClick={() => onRoleFilter?.(role)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 transition-all ${
                  isActive
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : "border-border bg-muted/30 hover:border-primary/40 hover:bg-muted/50"
                }`}
              >
                <span className={`text-xs font-semibold ${isActive ? "text-primary-foreground" : "text-foreground"}`}>
                  {role}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                    isActive ? "bg-primary-foreground/20 text-primary-foreground" : "bg-primary/10 text-primary"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export interface CategoryDatum {
  name: string;
  value: number;
  fill: string;
}

export function CategoryChart({ data }: { data: CategoryDatum[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <PieChartIcon className="h-4 w-4 text-primary" />
          Distributie Categorii
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data.length > 0 ? (
          <div className="flex items-center gap-2">
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={70}
                  innerRadius={35}
                  strokeWidth={2}
                  stroke="hsl(var(--card))"
                >
                  {data.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-1.5 text-xs min-w-0 shrink-0">
              {data.map((c) => (
                <div key={c.name} className="flex items-center gap-1.5">
                  <div className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: c.fill }} />
                  <span className="truncate text-muted-foreground">{c.name}</span>
                  <span className="font-semibold text-foreground">{c.value}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="py-8 text-center text-xs text-muted-foreground">Fara date</p>
        )}
      </CardContent>
    </Card>
  );
}

export interface NamedDatum {
  name: string;
  value: number;
}

export function StadiiChart({ data }: { data: NamedDatum[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <BarChart3 className="h-4 w-4 text-primary" />
          Stadii Procesuale
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data.length > 0 ? (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false}
                tickLine={false}
                interval={0}
                angle={-30}
                textAnchor="end"
                height={50}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "transparent" }} isAnimationActive={false} />
              <Bar dataKey="value" fill={CHART_FILLS.primary} radius={[4, 4, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="py-8 text-center text-xs text-muted-foreground">Fara date</p>
        )}
      </CardContent>
    </Card>
  );
}

export function InstitutiiChart({ data, title = "Top 5 Institutii" }: { data: NamedDatum[]; title?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Building2 className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data.length > 0 ? (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={data} layout="vertical" margin={{ top: 5, right: 15, bottom: 5, left: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false}
                tickLine={false}
                width={90}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "transparent" }} isAnimationActive={false} />
              <Bar dataKey="value" fill={CHART_FILLS.accent} radius={[0, 4, 4, 0]} maxBarSize={24} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="py-8 text-center text-xs text-muted-foreground">Fara date</p>
        )}
      </CardContent>
    </Card>
  );
}

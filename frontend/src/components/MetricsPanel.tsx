import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, PieChart as PieChartIcon, Building2, Users, FolderOpen, Scale, ChevronDown, ChevronUp } from "lucide-react";
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
import type { Dosar } from "@/types";
import { normalizeInstitutie } from "@/lib/institutii";
import { CATEGORY_COLORS, CATEGORY_FALLBACK, CHART_FILLS } from "@/lib/chart-colors";

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

interface MetricsPanelProps {
  dosare: Dosar[];
  searchedName?: string;
  selectedRoles?: string[];
  onRoleFilter?: (role: string) => void;
}

const KNOWN_CATS: [string, string][] = [
  ["penal", "Penal"],
  ["civil", "Civil"],
  ["contencios", "Contencios"],
  ["munc", "Litigii munca"],
  ["faliment", "Faliment"],
  ["profesioni", "Profesionisti"],
];

function classifyCategory(cat: string): string {
  const lower = (cat ?? "").toLowerCase();
  for (const [key, label] of KNOWN_CATS) {
    if (lower.includes(key)) return label;
  }
  return "Altele";
}

function countByField(dosare: Dosar[], classify: (d: Dosar) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const d of dosare) {
    const key = classify(d) || "Necunoscut";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

// Custom tooltip for recharts
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name?: string; payload?: { name: string } }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-foreground">{label || payload[0]?.payload?.name}</p>
      <p className="text-muted-foreground">{payload[0].value} dosare</p>
    </div>
  );
}

export function MetricsPanel({ dosare, searchedName, selectedRoles = [], onRoleFilter }: MetricsPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const categoryData = useMemo(() => {
    const counts = countByField(dosare, (d) => classifyCategory(d.categorieCaz));
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value, fill: CATEGORY_COLORS[name] || CATEGORY_FALLBACK }))
      .sort((a, b) => b.value - a.value);
  }, [dosare]);

  const stadiiData = useMemo(() => {
    const counts = countByField(dosare, (d) => d.stadiuProcesual || "Necunoscut");
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [dosare]);

  const institutiiCounts = useMemo(
    () => countByField(dosare, (d) => d.institutie || "Necunoscut"),
    [dosare],
  );

  const totalInstitutii = useMemo(
    () => Object.keys(institutiiCounts).length,
    [institutiiCounts],
  );

  const topInstitutii = useMemo(() => {
    return Object.entries(institutiiCounts)
      .map(([name, value]) => ({ name: formatInstitutieShort(name), value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [institutiiCounts]);

  const partyAnalysis = useMemo(() => {
    if (!searchedName) return null;
    const searchWords = stripDiacritics(searchedName.toLowerCase()).trim().split(/\s+/).filter(Boolean);
    if (searchWords.length === 0) return null;
    const roleMap: Record<string, number> = {};
    for (const d of dosare) {
      for (const p of d.parti) {
        const nameLower = stripDiacritics(p.nume.toLowerCase());
        if (searchWords.every((w) => nameLower.includes(w))) {
          const role = p.calitateParte || "Necunoscut";
          roleMap[role] = (roleMap[role] || 0) + 1;
        }
      }
    }
    return Object.entries(roleMap)
      .map(([role, count]) => ({ role, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [dosare, searchedName]);

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

      {/* Summary cards row */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          icon={FolderOpen}
          label="Total Dosare"
          value={dosare.length}
          color="text-primary"
          bg="bg-primary/10"
        />
        <SummaryCard
          icon={PieChartIcon}
          label="Categorii"
          value={categoryData.length}
          color="text-blue-500"
          bg="bg-blue-500/10"
          detail={categoryData.slice(0, 3).map((c) => `${c.name}: ${c.value}`).join(", ")}
        />
        <SummaryCard
          icon={Scale}
          label="Stadii"
          value={stadiiData.length}
          color="text-purple-500"
          bg="bg-purple-500/10"
          detail={stadiiData.slice(0, 3).map((s) => `${s.name}: ${s.value}`).join(", ")}
        />
        <SummaryCard
          icon={Building2}
          label="Institutii"
          value={totalInstitutii}
          color="text-teal-500"
          bg="bg-teal-500/10"
          detail={topInstitutii.length > 0 ? `Top: ${topInstitutii[0].name}` : undefined}
        />
      </div>

      {expanded && <>
      {/* Party analysis */}
      {partyAnalysis && partyAnalysis.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Users className="h-4 w-4 text-primary" />
              Analiza Parte: &quot;{searchedName}&quot;
              {selectedRoles.length > 0 && (
                <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                  ({selectedRoles.length} {selectedRoles.length === 1 ? "filtru activ" : "filtre active"} — click pentru a anula)
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {partyAnalysis.map(({ role, count }) => {
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
                        isActive
                          ? "bg-primary-foreground/20 text-primary-foreground"
                          : "bg-primary/10 text-primary"
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
      )}

      {/* Charts row */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Pie chart - categorie */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <PieChartIcon className="h-4 w-4 text-primary" />
              Distributie Categorii
            </CardTitle>
          </CardHeader>
          <CardContent>
            {categoryData.length > 0 ? (
              <div className="flex items-center gap-2">
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie
                      data={categoryData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={70}
                      innerRadius={35}
                      strokeWidth={2}
                      stroke="hsl(var(--card))"
                    >
                      {categoryData.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1.5 text-xs min-w-0 shrink-0">
                  {categoryData.map((c) => (
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

        {/* Bar chart - stadiu */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <BarChart3 className="h-4 w-4 text-primary" />
              Stadii Procesuale
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stadiiData.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={stadiiData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
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
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="value" fill={CHART_FILLS.primary} radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="py-8 text-center text-xs text-muted-foreground">Fara date</p>
            )}
          </CardContent>
        </Card>

        {/* Horizontal bar chart - top institutii */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Building2 className="h-4 w-4 text-primary" />
              Top 5 Institutii
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topInstitutii.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={topInstitutii} layout="vertical" margin={{ top: 5, right: 15, bottom: 5, left: 5 }}>
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
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="value" fill={CHART_FILLS.accent} radius={[0, 4, 4, 0]} maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="py-8 text-center text-xs text-muted-foreground">Fara date</p>
            )}
          </CardContent>
        </Card>
      </div>
      </>}
    </div>
  );
}

function SummaryCard({
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
          {detail && (
            <p className="truncate text-[11px] text-muted-foreground">{detail}</p>
          )}
        </div>
      </div>
    </Card>
  );
}

function formatInstitutieShort(raw: string): string {
  if (!raw) return "-";
  const normalized = normalizeInstitutie(raw);
  const prefixes: [RegExp, string][] = [
    [/^Curtea\s*de\s*Apel\s*/i, "CA "],
    [/^Înalta\s*Curte\s*/i, "ICCJ "],
    [/^Tribunalul\s*/i, "Trib. "],
    [/^Judecătoria\s*/i, "Jud. "],
  ];
  for (const [re, replacement] of prefixes) {
    if (re.test(normalized)) {
      return (replacement + normalized.replace(re, "")).trim();
    }
  }
  return normalized.length > 25 ? normalized.substring(0, 25) + "..." : normalized;
}

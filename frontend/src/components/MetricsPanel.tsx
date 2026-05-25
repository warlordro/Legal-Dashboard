import { useMemo, useState } from "react";
import {
  BarChart3,
  PieChart as PieChartIcon,
  Building2,
  FolderOpen,
  Scale,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import type { Dosar } from "@/types";
import { normalizeInstitutie } from "@/lib/institutii";
import { CATEGORY_COLORS, CATEGORY_FALLBACK } from "@/lib/chart-colors";
import { dropLegalFormTokens } from "@/lib/legalSuffix";
import { SummaryCard, PartyAnalysisCard, CategoryChart, StadiiChart, InstitutiiChart } from "./metrics-panel-parts";

function stripDiacritics(s: string): string {
  // biome-ignore lint/suspicious/noMisleadingCharacterClass: range-ul combina diacriticele dupa normalizare NFD.
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

  const institutiiCounts = useMemo(() => countByField(dosare, (d) => d.institutie || "Necunoscut"), [dosare]);

  const totalInstitutii = useMemo(() => Object.keys(institutiiCounts).length, [institutiiCounts]);

  const topInstitutii = useMemo(() => {
    return Object.entries(institutiiCounts)
      .map(([name, value]) => ({ name: formatInstitutieShort(name), value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [institutiiCounts]);

  const partyAnalysis = useMemo(() => {
    if (!searchedName) return null;
    const rawWords = stripDiacritics(searchedName.toLowerCase()).trim().split(/\s+/).filter(Boolean);
    const filtered = dropLegalFormTokens(rawWords);
    const searchWords = filtered.length > 0 ? filtered : rawWords;
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
          detail={categoryData
            .slice(0, 3)
            .map((c) => `${c.name}: ${c.value}`)
            .join(", ")}
        />
        <SummaryCard
          icon={Scale}
          label="Stadii"
          value={stadiiData.length}
          color="text-purple-500"
          bg="bg-purple-500/10"
          detail={stadiiData
            .slice(0, 3)
            .map((s) => `${s.name}: ${s.value}`)
            .join(", ")}
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

      {expanded && (
        <>
          {partyAnalysis && partyAnalysis.length > 0 && searchedName && (
            <PartyAnalysisCard
              searchedName={searchedName}
              entries={partyAnalysis}
              selectedRoles={selectedRoles}
              onRoleFilter={onRoleFilter}
            />
          )}

          <div className="grid gap-4 lg:grid-cols-3">
            <CategoryChart data={categoryData} />
            <StadiiChart data={stadiiData} />
            <InstitutiiChart data={topInstitutii} />
          </div>
        </>
      )}
    </div>
  );
}

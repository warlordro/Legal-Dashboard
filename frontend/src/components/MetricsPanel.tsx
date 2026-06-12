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
import type { Dosar, DosarSource } from "@/types";
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
  // ICCJ list rows carry empty categorieCaz + empty calitateParte (those arrive only
  // after Tier-2 detail enrichment) and a constant institutie. Source-awareness swaps
  // the 4th card to Departamente and hides Categorii + Analiza Parte until enriched.
  source?: DosarSource;
}

function shortLabel(raw: string): string {
  if (!raw) return "-";
  return raw.length > 25 ? `${raw.substring(0, 25)}...` : raw;
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

export function MetricsPanel({
  dosare,
  searchedName,
  selectedRoles = [],
  onRoleFilter,
  source = "portaljust",
}: MetricsPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const isIccj = source === "iccj";
  // Enriched once any loaded dosar carries a categorie or a party role — i.e. Tier-2
  // detail enrichment has run. Before that, Categorii + Analiza Parte would be all
  // "Altele" / "Necunoscut", so we hide them for ICCJ.
  const iccjEnriched = !isIccj || dosare.some((d) => d.categorieCaz || d.parti.some((p) => p.calitateParte));
  const showCategorii = !isIccj || iccjEnriched;

  const categoryData = useMemo(() => {
    if (!showCategorii) return [];
    // During a PARTIAL ICCJ enrich, rows not yet enriched have categorieCaz="" — counting
    // them would dump everything into an "Altele" bucket, conflating "not yet enriched"
    // with "genuinely other". Count only rows that actually have a category for ICCJ.
    const rows = isIccj ? dosare.filter((d) => d.categorieCaz) : dosare;
    const counts = countByField(rows, (d) => classifyCategory(d.categorieCaz));
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value, fill: CATEGORY_COLORS[name] || CATEGORY_FALLBACK }))
      .sort((a, b) => b.value - a.value);
  }, [dosare, showCategorii, isIccj]);

  const stadiiData = useMemo(() => {
    const counts = countByField(dosare, (d) => d.stadiuProcesual || "Necunoscut");
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [dosare]);

  // 4th dimension: PortalJust -> Institutii (d.institutie); ICCJ -> Departamente
  // (d.departament — institutie is a constant for ICCJ, so its count is always 1).
  const fourthLabel = isIccj ? "Departamente" : "Institutii";
  const fourthCounts = useMemo(
    () => countByField(dosare, (d) => (isIccj ? d.departament : d.institutie) || "Necunoscut"),
    [dosare, isIccj]
  );
  const totalFourth = useMemo(() => Object.keys(fourthCounts).length, [fourthCounts]);
  const topFourth = useMemo(
    () =>
      Object.entries(fourthCounts)
        .map(([name, value]) => ({ name: isIccj ? shortLabel(name) : formatInstitutieShort(name), value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 5),
    [fourthCounts, isIccj]
  );

  const partyAnalysis = useMemo(() => {
    if (!searchedName || !iccjEnriched) return null;
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
  }, [dosare, searchedName, iccjEnriched]);

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
          detail={
            showCategorii
              ? categoryData
                  .slice(0, 3)
                  .map((c) => `${c.name}: ${c.value}`)
                  .join(", ")
              : "Necesita analiza detaliata"
          }
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
          label={fourthLabel}
          value={totalFourth}
          color="text-teal-500"
          bg="bg-teal-500/10"
          detail={topFourth.length > 0 ? `Top: ${topFourth[0].name}` : undefined}
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
            {showCategorii && <CategoryChart data={categoryData} />}
            <StadiiChart data={stadiiData} />
            <InstitutiiChart data={topFourth} title={isIccj ? "Top 5 Departamente" : "Top 5 Institutii"} />
          </div>
        </>
      )}
    </div>
  );
}

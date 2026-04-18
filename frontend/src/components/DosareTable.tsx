import { useState, useEffect, useRef, useCallback, Fragment } from "react";
import DOMPurify from "dompurify";
import { ChevronDown, ChevronUp, FileText, Download, ExternalLink, Users, Calendar, Building2, Scale, FileCheck, Bot, Loader2, Key, Eye } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Card } from "./ui/card";
import { formatDate, splitConcatenatedWords, formatDocumentSedinta } from "@/lib/utils";
import { api } from "@/lib/api";
import type { Dosar } from "@/types";
import { normalizeInstitutie } from "@/lib/institutii";
import { exportAnalysisPDF } from "@/lib/export";

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

interface ApiKeys {
  anthropic: string;
  openai: string;
  google: string;
}

interface DosareTableProps {
  dosare: Dosar[];
  onExportExcel: (selected?: Dosar[]) => void;
  onExportPDF: (selected?: Dosar[]) => void;
  searchedName?: string;
  apiKeys?: ApiKeys;
  onConfigureApiKey?: () => void;
}

function isNameMatch(partyName: string, searchedName: string): boolean {
  const nameLower = stripDiacritics(partyName.toLowerCase());
  const searchWords = stripDiacritics(searchedName.toLowerCase()).trim().split(/\s+/).filter(Boolean);
  if (searchWords.length === 0) return false;
  return searchWords.every((word) => nameLower.includes(word));
}

// Expand a plain character to a regex class matching all Romanian diacritic variants
const DIAC_MAP: Record<string, string> = {
  a: "[aăâ]", A: "[AĂÂ]",
  i: "[iî]", I: "[IÎ]",
  s: "[sșş]", S: "[SȘŞ]",
  t: "[tțţ]", T: "[TȚŢ]",
};

function expandDiacritics(word: string): string {
  return [...word].map((c) => DIAC_MAP[c] ?? c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("");
}

function HighlightName({ text, search }: { text: string; search?: string }) {
  if (!search || !text) return <>{text}</>;
  const searchWords = stripDiacritics(search.toLowerCase()).trim().split(/\s+/).filter(Boolean);
  if (searchWords.length === 0) return <>{text}</>;

  // Build regex that matches any of the search words with diacritic variants
  const patterns = searchWords.map((w) => expandDiacritics(w));
  const regex = new RegExp(`(${patterns.join("|")})`, "gi");
  const parts = text.split(regex);

  return (
    <>
      {parts.map((part, i) => {
        const isMatch = searchWords.some((w) => stripDiacritics(part.toLowerCase()) === w);
        return isMatch ? (
          <span key={i} className="rounded bg-yellow-200 px-0.5 font-semibold text-yellow-900 dark:bg-yellow-500/30 dark:text-yellow-200">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        );
      })}
    </>
  );
}

function getStadiuBadgeColor(stadiu: string): string {
  const s = (stadiu ?? "").toLowerCase();
  if (s.includes("fond")) return "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/40 dark:text-slate-400 dark:border-slate-700";
  if (s.includes("apel")) return "bg-sky-50 text-sky-600 border-sky-200 dark:bg-sky-900/30 dark:text-sky-400 dark:border-sky-800";
  if (s.includes("recurs")) return "bg-indigo-50 text-indigo-600 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-400 dark:border-indigo-800";
  if (s.includes("suspendat")) return "bg-orange-50 text-orange-600 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800";
  return "bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-800/30 dark:text-slate-400 dark:border-slate-700";
}

function getCategorieBadgeColor(categorie: string): string {
  const c = (categorie ?? "").toLowerCase();
  if (c.includes("penal")) return "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800";
  if (c.includes("civil")) return "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800";
  if (c.includes("contencios")) return "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800";
  if (c.includes("munc")) return "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-400 dark:border-purple-800";
  if (c.includes("faliment") || c.includes("insolven")) return "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800";
  if (c.includes("profesioni")) return "bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-900/30 dark:text-teal-400 dark:border-teal-800";
  return "bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-900/30 dark:text-gray-400 dark:border-gray-700";
}

function getSolutieBadgeVariant(solutie: string): "default" | "secondary" | "outline" | "success" | "warning" {
  const s = (solutie ?? "").toLowerCase();
  if (s.includes("admite") || s.includes("hotărâre") || s.includes("hotarare")) return "success";
  if (s.includes("respinge") || s.includes("perim")) return "warning";
  if (s.includes("amân")) return "secondary";
  return "outline";
}

// "CurteadeApelBUCURESTI" → "Curtea de Apel BUCURESTI"
// "TribunalulPRAHOVA" → "Tribunalul PRAHOVA"
// "JudecatoriaFOCSANI" → "Judecatoria FOCSANI"
function formatInstitutie(raw: string): string {
  if (!raw) return "-";
  return normalizeInstitutie(raw);
}


function getPortalJustUrl(numar: string): string {
  // Main portal search - generates working Dosar.aspx links when clicking results
  return `https://portal.just.ro/SitePages/cautare.aspx?k=${encodeURIComponent(numar)}`;
}

function getPageNumbers(currentPage: number, totalPages: number): (number | "...")[] {
  const pages: (number | "...")[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
    return pages;
  }
  const current = currentPage + 1;
  pages.push(1);
  if (current > 3) pages.push("...");
  for (let i = Math.max(2, current - 1); i <= Math.min(totalPages - 1, current + 1); i++) {
    pages.push(i);
  }
  if (current < totalPages - 2) pages.push("...");
  pages.push(totalPages);
  return pages;
}

type SortKey = "numar" | "data" | "institutie";

export function DosareTable({ dosare, onExportExcel, onExportPDF, searchedName, apiKeys, onConfigureApiKey }: DosareTableProps) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("data");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [aiAnalysis, setAiAnalysis] = useState<Record<string, string>>({});
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiModel, setAiModel] = useState<string>("claude-sonnet");
  const [showKeyPrompt, setShowKeyPrompt] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hiddenAnalysis, setHiddenAnalysis] = useState<Set<string>>(new Set());
  const [collapsedAiConfig, setCollapsedAiConfig] = useState<Set<string>>(new Set());
  const expandedDetailRef = useRef<HTMLTableRowElement>(null);

  // Track viewed (expanded) dosare — persist in sessionStorage
  const [viewedDosare, setViewedDosare] = useState<Set<string>>(() => {
    try {
      const saved = sessionStorage.getItem("viewedDosare");
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });

  const markAsViewed = useCallback((numar: string) => {
    setViewedDosare((prev) => {
      if (prev.has(numar)) return prev;
      const next = new Set(prev);
      next.add(numar);
      try { sessionStorage.setItem("viewedDosare", JSON.stringify([...next])); } catch { /* sessionStorage unavailable; visited-markers are best-effort */ }
      return next;
    });
  }, []);

  // Auto-scroll to expanded row details
  useEffect(() => {
    if (expandedIdx === null) return;
    // Small delay to let the DOM render the expanded content
    const timer = setTimeout(() => {
      const el = expandedDetailRef.current;
      if (!el) return;
      // Find scrollable parent (could be overflow container or window)
      let parent = el.parentElement as HTMLElement | null;
      while (parent) {
        const style = getComputedStyle(parent);
        if (
          (style.overflowY === "auto" || style.overflowY === "scroll") &&
          parent.scrollHeight > parent.clientHeight
        ) {
          const elRect = el.getBoundingClientRect();
          const parentRect = parent.getBoundingClientRect();
          // Only scroll if the expanded detail is not fully visible
          if (elRect.bottom > parentRect.bottom || elRect.top < parentRect.top) {
            // Scroll so the top of the expanded row is visible with some padding
            parent.scrollTo({
              top: parent.scrollTop + (elRect.top - parentRect.top) - 80,
              behavior: "smooth",
            });
          }
          return;
        }
        parent = parent.parentElement;
      }
      // Fallback: use window scroll
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 50);
    return () => clearTimeout(timer);
  }, [expandedIdx]);

  // Multi-agent state
  const [multiMode, setMultiMode] = useState(false);
  const [multiAnalysts, setMultiAnalysts] = useState<[string, string]>(["claude-sonnet", "gpt-5.4-mini"]);
  const [multiJudge, setMultiJudge] = useState<string>("claude-opus");
  const [multiLoading, setMultiLoading] = useState<string | null>(null);
  const [multiResult, setMultiResult] = useState<Record<string, {
    analyses: { analyst1: { model: string; text: string }; analyst2: { model: string; text: string } };
    judge: { model: string; text: string };
    final: string;
  }>>({});
  const [multiError, setMultiError] = useState<string | null>(null);
  const [showIndividual, setShowIndividual] = useState<Set<string>>(new Set());
  const mc = {
    border: "border-blue-100 dark:border-blue-900",
    bg: "bg-blue-50/30 dark:bg-blue-950/20",
    hoverBg: "hover:bg-blue-50/50 dark:hover:bg-blue-950/30",
    text: "text-blue-700 dark:text-blue-400",
    chevron: "text-blue-400",
    btnBorder: "border-blue-200 dark:border-blue-800",
    btnText: "text-blue-700 dark:text-blue-400",
    btnHover: "hover:bg-blue-50 dark:hover:bg-blue-950",
    selectBorder: "border-blue-100 dark:border-blue-900",
    selectLabel: "text-blue-600",
    selectActive: "bg-blue-600 text-white shadow-sm",
    bullet: "text-blue-400",
    num: "text-blue-600 dark:text-blue-400",
    link: "text-blue-600 dark:text-blue-400",
    linkHover: "hover:text-blue-700 dark:hover:text-blue-300",
  };

  const AI_MODELS = [
    // Claude
    { key: "claude-haiku", label: "Haiku 4.5", provider: "anthropic", desc: "Rapid", color: "violet" },
    { key: "claude-sonnet", label: "Sonnet 4.6", provider: "anthropic", desc: "Echilibrat", color: "violet" },
    { key: "claude-opus", label: "Opus 4.6", provider: "anthropic", desc: "Premium", color: "violet" },
    // OpenAI
    { key: "gpt-5.4-nano", label: "5.4 nano", provider: "openai", desc: "Rapid", color: "emerald" },
    { key: "gpt-5.4-mini", label: "5.4 mini", provider: "openai", desc: "Echilibrat", color: "emerald" },
    { key: "gpt-5.4", label: "GPT-5.4", provider: "openai", desc: "Premium", color: "emerald" },
    // Google
    { key: "gemini-flash-lite-3", label: "3.1 Lite", provider: "google", desc: "Rapid", color: "blue" },
    { key: "gemini-flash-3", label: "3 Flash", provider: "google", desc: "Echilibrat", color: "blue" },
    { key: "gemini-pro-3", label: "3.1 Pro", provider: "google", desc: "Premium", color: "blue" },
  ];

  const JUDGE_MODELS_LIST = [
    { key: "claude-opus", label: "Claude Opus 4.6", provider: "anthropic", color: "violet", desc: "Premium" },
    { key: "gpt-5.4", label: "GPT-5.4", provider: "openai", color: "emerald", desc: "Premium" },
    { key: "gemini-pro-3", label: "Gemini 3.1 Pro", provider: "google", color: "blue", desc: "Premium" },
  ];

  const hasAnyKey = apiKeys && (apiKeys.anthropic || apiKeys.openai || apiKeys.google);

  // Filter to only show models with active keys
  const availableModels = AI_MODELS.filter((m) => {
    if (m.provider === "anthropic") return apiKeys?.anthropic;
    if (m.provider === "openai") return apiKeys?.openai;
    if (m.provider === "google") return apiKeys?.google;
    return false;
  });

  // Group available models by provider
  const providerGroups = availableModels.reduce((acc, m) => {
    if (!acc[m.provider]) acc[m.provider] = [];
    acc[m.provider].push(m);
    return acc;
  }, {} as Record<string, typeof AI_MODELS>);

  const PROVIDER_LABELS: Record<string, string> = {
    anthropic: "Claude",
    openai: "GPT",
    google: "Gemini",
  };

  const handleAiAnalyze = async (dosar: Dosar) => {
    if (!hasAnyKey) {
      setShowKeyPrompt(true);
      return;
    }
    // Check if selected model's provider has a key
    const selectedModelDef = AI_MODELS.find((m) => m.key === aiModel);
    if (selectedModelDef && !availableModels.find((m) => m.key === aiModel)) {
      // Selected model's provider has no key - switch to first available
      if (availableModels.length > 0) {
        setAiModel(availableModels[0].key);
      }
      setShowKeyPrompt(true);
      return;
    }
    const key = dosar.numar;
    setAiLoading(key);
    setAiError(null);
    try {
      const result = await api.ai.analyze(dosar, aiModel, apiKeys);
      setAiAnalysis((prev) => ({ ...prev, [key]: result.analysis }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Eroare la analiza AI";
      if (msg.includes("401") || msg.includes("invalid") || msg.includes("authentication")) {
        setAiError("Cheie API invalida. Verifica setarile.");
      } else {
        setAiError(msg);
      }
    } finally {
      setAiLoading(null);
    }
  };


  const handleMultiAnalyze = async (dosar: Dosar) => {
    if (!hasAnyKey) { setShowKeyPrompt(true); return; }
    // Check required provider keys
    const neededProviders = new Set<string>();
    for (const m of [...multiAnalysts, multiJudge]) {
      const modelDef = AI_MODELS.find((mod) => mod.key === m);
      if (modelDef) neededProviders.add(modelDef.provider);
    }
    for (const provider of neededProviders) {
      if (provider === "anthropic" && !apiKeys?.anthropic) { setMultiError("Lipseste cheia API pentru Anthropic (Claude)"); return; }
      if (provider === "openai" && !apiKeys?.openai) { setMultiError("Lipseste cheia API pentru OpenAI (GPT)"); return; }
      if (provider === "google" && !apiKeys?.google) { setMultiError("Lipseste cheia API pentru Google (Gemini)"); return; }
    }
    setMultiLoading(dosar.numar);
    setMultiError(null);
    try {
      const result = await api.ai.analyzeMulti(dosar, multiAnalysts, multiJudge, apiKeys);
      setMultiResult((prev) => ({ ...prev, [dosar.numar]: result }));
    } catch (err: unknown) {
      setMultiError(err instanceof Error ? err.message : "Eroare la analiza avansata");
    } finally {
      setMultiLoading(null);
    }
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
    setPage(0);
  };

  const sorted = [...dosare].sort((a, b) => {
    const av = a[sortKey] ?? "";
    const bv = b[sortKey] ?? "";
    return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
  });

  const totalPages = Math.ceil(dosare.length / pageSize);

  // Clamp page when list shrinks (filters reduce count below current page bounds).
  // Without this, the table renders empty — results exist but on a page that no longer exists.
  useEffect(() => {
    if (totalPages > 0 && page >= totalPages) setPage(0);
  }, [totalPages, page]);

  const paged = sorted.slice(page * pageSize, (page + 1) * pageSize);

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey === k ? (
      sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
    ) : null;

  const colCount = 8;

  const toggleSelect = (numar: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(numar)) next.delete(numar);
      else next.add(numar);
      return next;
    });
  };

  const allPageSelected = paged.length > 0 && paged.every((d) => selected.has(d.numar));
  const toggleSelectAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        paged.forEach((d) => next.delete(d.numar));
      } else {
        paged.forEach((d) => next.add(d.numar));
      }
      return next;
    });
  };

  const getExportDosare = (): Dosar[] => {
    if (selected.size === 0) return dosare;
    return dosare.filter((d) => selected.has(d.numar));
  };

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">{dosare.length} dosare gasite</span>
          {selected.size > 0 && (
            <span className="text-xs text-violet-600 font-medium ml-1">
              ({selected.size} selectate)
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <button className="text-xs text-muted-foreground hover:text-foreground underline" onClick={() => setSelected(new Set())}>
              Deselecteaza tot
            </button>
          )}
          <Button variant="outline" size="sm" onClick={() => onExportExcel(getExportDosare())}>
            <Download className="h-4 w-4" /> Excel {selected.size > 0 ? `(${selected.size})` : ""}
          </Button>
          <Button variant="outline" size="sm" onClick={() => onExportPDF(getExportDosare())}>
            <Download className="h-4 w-4" /> PDF {selected.size > 0 ? `(${selected.size})` : ""}
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-3 py-3 w-8">
                <input
                  type="checkbox"
                  checked={allPageSelected}
                  onChange={toggleSelectAll}
                  className="h-4 w-4 rounded border-border accent-violet-600 cursor-pointer"
                  title="Selecteaza/deselecteaza pagina curenta"
                />
              </th>
              {(
                [
                  ["numar", "Numar Dosar"],
                ] as [SortKey, string][]
              ).map(([key, label]) => (
                <th
                  key={key}
                  className="cursor-pointer px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                  onClick={() => toggleSort(key)}
                >
                  <span className="flex items-center gap-1">{label} <SortIcon k={key} /></span>
                </th>
              ))}
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Categorie</th>
              {(
                [
                  ["data", "Data"],
                  ["institutie", "Institutie"],
                ] as [SortKey, string][]
              ).map(([key, label]) => (
                <th
                  key={key}
                  className="cursor-pointer px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                  onClick={() => toggleSort(key)}
                >
                  <span className="flex items-center gap-1">{label} <SortIcon k={key} /></span>
                </th>
              ))}
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Parti</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sedinte</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {paged.map((dosar, i) => {
              const globalIdx = page * pageSize + i;
              const isExpanded = expandedIdx === globalIdx;
              return (
                <Fragment key={`dosar-${dosar.numar}-${i}`}>
                  <tr
                    className={`transition-colors cursor-pointer hover:bg-muted/30 ${isExpanded ? "bg-muted/40" : ""} ${selected.has(dosar.numar) ? "bg-violet-50 dark:bg-violet-900/10" : ""}`}
                    onClick={() => {
                      setExpandedIdx(isExpanded ? null : globalIdx);
                      if (!isExpanded && dosar.numar) markAsViewed(dosar.numar);
                    }}
                  >
                    <td className="px-3 py-3 w-8" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(dosar.numar)}
                        onChange={() => toggleSelect(dosar.numar)}
                        className="h-4 w-4 rounded border-border accent-violet-600 cursor-pointer"
                      />
                    </td>
                    <td className="px-4 py-3 font-mono text-sm font-semibold">
                      <div className="flex items-center gap-1.5">
                        {dosar.numar && !viewedDosare.has(dosar.numar) ? (
                          <span className="relative flex h-2.5 w-2.5 shrink-0" title="Nevizualizat">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
                            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-blue-500" />
                          </span>
                        ) : dosar.numar && viewedDosare.has(dosar.numar) ? (
                          <span title="Vizualizat"><Eye className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" /></span>
                        ) : null}
                        {dosar.numar ? (
                          <a
                            href={getPortalJustUrl(dosar.numar)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-primary hover:text-primary/80 hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {dosar.numar}
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                        ) : "-"}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        {dosar.categorieCaz && <Badge variant="outline" className={`text-xs ${getCategorieBadgeColor(dosar.categorieCaz)}`}>{dosar.categorieCaz}</Badge>}
                        {dosar.stadiuProcesual && <Badge variant="outline" className={`text-xs ${getStadiuBadgeColor(dosar.stadiuProcesual)}`}>{dosar.stadiuProcesual}</Badge>}
                      </div>
                    </td>
                    <td className={`px-4 py-3 text-[13px] whitespace-nowrap ${isExpanded ? "font-bold text-red-800 dark:text-red-400" : "text-foreground"}`}>
                      {formatDate(dosar.data)}
                    </td>
                    <td className={`px-4 py-3 text-[13px] max-w-[220px] truncate ${isExpanded ? "font-bold text-red-800 dark:text-red-400" : ""}`} title={normalizeInstitutie(dosar.institutie)}>
                      {formatInstitutie(dosar.institutie)}
                    </td>
                    <td className="px-4 py-3 text-[13px] max-w-[220px]">
                      {dosar.parti.slice(0, 2).map((p, j) => (
                        <div key={j} className="truncate" title={p.nume}>
                          <span className="text-muted-foreground">{p.calitateParte}: </span>
                          <HighlightName text={p.nume} search={searchedName} />
                        </div>
                      ))}
                      {dosar.parti.length > 2 && (
                        <span className="text-muted-foreground">+{dosar.parti.length - 2} altii</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-center">
                      {dosar.sedinte.length > 0
                        ? <Badge variant="secondary" className="text-[11px]">{dosar.sedinte.length}</Badge>
                        : <span className="text-muted-foreground">0</span>
                      }
                    </td>
                    <td className="px-4 py-3">
                      <Button variant="ghost" size="icon" title={isExpanded ? "Inchide" : "Detalii"}>
                        <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                      </Button>
                    </td>
                  </tr>

                  {isExpanded && (
                    <tr ref={expandedDetailRef}>
                      <td colSpan={colCount} className="bg-muted/20 px-6 py-5">
                        <div className="space-y-4">
                          {/* Info grid */}
                          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                            <InfoItem icon={Calendar} label="Data Dosar" value={formatDate(dosar.data)} />
                            <InfoItem icon={Building2} label="Departament" value={dosar.departament || "-"} />
                            <InfoItem icon={Scale} label="Categorie" value={dosar.categorieCaz || "-"} />
                            <InfoItem label="Stadiu" value={dosar.stadiuProcesual || "-"} />
                          </div>

                          {dosar.obiect && (
                            <div>
                              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Obiect Dosar
                              </h4>
                              <p className="text-sm">{dosar.obiect}</p>
                            </div>
                          )}

                          {/* Parti */}
                          {dosar.parti.length > 0 && (
                            <div>
                              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                <Users className="h-3.5 w-3.5" /> Parti ({dosar.parti.length})
                              </h4>
                              <div className="grid gap-1 rounded-lg border border-border bg-background p-3 sm:grid-cols-2">
                                {dosar.parti.map((p, j) => {
                                  return (
                                    <div key={j} className="flex items-center gap-1.5 text-xs">
                                      <Badge
                                        variant="outline"
                                        className="shrink-0 text-xs"
                                      >
                                        {p.calitateParte}
                                      </Badge>
                                      <span className="truncate" title={p.nume}>
                                        <HighlightName text={p.nume} search={searchedName} />
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Sedinte */}
                          {dosar.sedinte.length > 0 && (
                            <div>
                              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                <Calendar className="h-3.5 w-3.5" /> Sedinte ({dosar.sedinte.length})
                              </h4>
                              <div className="relative space-y-0">
                                {/* Timeline line */}
                                <div className="absolute left-[92px] top-0 bottom-0 w-px bg-border" />
                                {dosar.sedinte.map((s, j) => (
                                  <div key={j} className="relative flex gap-4 py-3 first:pt-0 last:pb-0">
                                    {/* Date + Time column */}
                                    <div className="w-[80px] shrink-0 text-right">
                                      <span className="font-mono text-xs font-bold text-primary">
                                        {formatDate(s.data)}
                                      </span>
                                      {s.ora && (
                                        <span className="block font-mono text-[11px] text-muted-foreground">{s.ora}</span>
                                      )}
                                    </div>
                                    {/* Timeline dot */}
                                    <div className="relative z-10 mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-primary bg-background" />
                                    {/* Content */}
                                    <div className="flex-1 min-w-0 rounded-lg border border-border bg-background p-3">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        {s.complet && (
                                          <span className="text-xs text-muted-foreground">{s.complet}</span>
                                        )}
                                        {s.solutie && (
                                          <Badge variant={getSolutieBadgeVariant(s.solutie)} className="text-[11px]">
                                            {s.solutie}
                                          </Badge>
                                        )}
                                      </div>
                                      {(s.documentSedinta || s.solutieSumar) && (
                                        <div className="mt-2 rounded bg-muted/30 p-2">
                                          {s.documentSedinta && (
                                            <div className="flex items-center gap-1.5 mb-1">
                                              <FileCheck className="h-3.5 w-3.5 text-primary shrink-0" />
                                              <span className="text-xs font-semibold text-foreground uppercase">
                                                {formatDocumentSedinta(s.documentSedinta)}
                                                {s.numarDocument && ` nr. ${s.numarDocument}`}
                                              </span>
                                            </div>
                                          )}
                                          {s.solutieSumar && (
                                            <p className="leading-relaxed text-foreground" style={{ fontSize: "14.5px" }}>{s.solutieSumar}</p>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Analiză AI - Collapsible per dosar */}
                          <div className="rounded-lg border border-violet-200 dark:border-violet-800 bg-violet-50/30 dark:bg-violet-950/20">
                            <button
                              className="flex w-full items-center justify-between p-4 pb-2 cursor-pointer hover:bg-violet-100/50 dark:hover:bg-violet-900/20 rounded-t-lg transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                setCollapsedAiConfig((prev) => {
                                  const next = new Set(prev);
                                  const key = `ai-${dosar.numar}`;
                                  if (next.has(key)) next.delete(key);
                                  else next.add(key);
                                  return next;
                                });
                              }}
                            >
                              <h4 className="flex items-center gap-1.5 text-sm font-semibold text-violet-700 dark:text-violet-400">
                                <Bot className="h-3.5 w-3.5" /> Analiză AI
                              </h4>
                              <div className="flex items-center gap-1.5">
                                {aiAnalysis[dosar.numar] && (
                                  <button
                                    className="p-1 rounded hover:bg-violet-100 dark:hover:bg-violet-900/30 text-violet-500 hover:text-violet-700 dark:hover:text-violet-300 transition-colors"
                                    title="Exportă PDF"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      exportAnalysisPDF(dosar.numar, dosar.institutie, dosar.obiect, aiAnalysis[dosar.numar]);
                                    }}
                                  >
                                    <Download className="h-3.5 w-3.5" />
                                  </button>
                                )}
                                <ChevronDown className={`h-4 w-4 text-violet-500 transition-transform ${collapsedAiConfig.has(`ai-${dosar.numar}`) ? "rotate-180" : ""}`} />
                              </div>
                            </button>
                            {collapsedAiConfig.has(`ai-${dosar.numar}`) && (
                              <div className="px-4 pb-4 space-y-3">
                                {/* Model selectors */}
                                {availableModels.length > 0 && (
                                  <div className="flex flex-col gap-1.5">
                                    {Object.entries(providerGroups).map(([provider, models]) => {
                                      const selectedInProvider = models.find((m) => m.key === aiModel);
                                      const colorMap: Record<string, string> = {
                                        violet: "bg-violet-600 text-white",
                                        emerald: "bg-emerald-600 text-white",
                                        blue: "bg-blue-600 text-white",
                                      };
                                      return (
                                        <div key={provider} className="flex items-center gap-0.5 rounded-lg border border-border bg-background p-0.5">
                                          <span className="px-1.5 text-[10px] font-semibold text-muted-foreground uppercase w-14">{PROVIDER_LABELS[provider]}</span>
                                          {models.map((m) => (
                                            <button
                                              key={m.key}
                                              onClick={(e) => { e.stopPropagation(); setAiModel(m.key); }}
                                              className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                                                aiModel === m.key
                                                  ? `${colorMap[m.color]} shadow-sm`
                                                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
                                              }`}
                                              title={m.desc}
                                            >
                                              {m.label}
                                            </button>
                                          ))}
                                          {selectedInProvider && (
                                            <span className="px-1.5 text-[10px] text-muted-foreground">{selectedInProvider.desc}</span>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                                {/* Analyze button */}
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="gap-2 border-violet-300 text-violet-700 hover:bg-violet-50 hover:text-violet-800 dark:border-violet-700 dark:text-violet-400 dark:hover:bg-violet-950"
                                  onClick={(e) => { e.stopPropagation(); handleAiAnalyze(dosar); }}
                                  disabled={aiLoading === dosar.numar}
                                >
                                  {aiLoading === dosar.numar ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Bot className="h-4 w-4" />
                                  )}
                                  {aiLoading === dosar.numar ? "Se analizează..." : aiAnalysis[dosar.numar] ? "Re-analizează" : "Analizează"}
                                </Button>
                                {showKeyPrompt && !hasAnyKey && (
                                  <p className="text-sm text-orange-600 dark:text-orange-400">
                                    <Key className="inline h-3.5 w-3.5 mr-1" />
                                    Configureaza cel putin o cheie API din <strong>Setari API</strong> (meniul din stanga) pentru a utiliza aceasta functie.
                                  </p>
                                )}
                                {aiError && aiLoading === null && !aiAnalysis[dosar.numar] && (
                                  <p className="text-sm text-destructive">{aiError}</p>
                                )}
                                {aiAnalysis[dosar.numar] && (
                                  <div className="prose prose-sm max-w-none text-sm leading-relaxed text-foreground dark:prose-invert [&_strong]:font-semibold [&_strong]:text-foreground [&_h1]:text-base [&_h1]:font-bold [&_h1]:mt-3 [&_h1]:mb-1 [&_h2]:text-sm [&_h2]:font-bold [&_h2]:mt-3 [&_h2]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_p]:my-1.5 [&_ul]:my-1 [&_li]:my-0.5">
                                    {aiAnalysis[dosar.numar].split("\n").map((line, li) => {
                                      if (line.startsWith("## ")) return <h2 key={li}>{line.slice(3)}</h2>;
                                      if (line.startsWith("### ")) return <h3 key={li}>{line.slice(4)}</h3>;
                                      if (line.startsWith("**") && line.endsWith("**")) return <h3 key={li}>{line.slice(2, -2)}</h3>;
                                      if (line.startsWith("- ") || line.startsWith("* ")) {
                                        const content = line.slice(2);
                                        return <div key={li} className="flex gap-2 ml-2"><span className="text-violet-500">•</span><span dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'), { ALLOWED_TAGS: ['strong', 'em', 'b', 'i'], ALLOWED_ATTR: [] }) }} /></div>;
                                      }
                                      if (line.match(/^\d+\.\s/)) {
                                        const content = line.replace(/^\d+\.\s/, "");
                                        const num = line.match(/^(\d+)\./)?.[1];
                                        return <div key={li} className="flex gap-2 ml-2"><span className="font-semibold text-violet-600 dark:text-violet-400 min-w-[1.2em]">{num}.</span><span dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'), { ALLOWED_TAGS: ['strong', 'em', 'b', 'i'], ALLOWED_ATTR: [] }) }} /></div>;
                                      }
                                      if (line.trim() === "") return <div key={li} className="h-2" />;
                                      return <p key={li} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'), { ALLOWED_TAGS: ['strong', 'em', 'b', 'i'], ALLOWED_ATTR: [] }) }} />;
                                    })}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                            {/* Multi-Agent Analysis - Collapsible per dosar */}
                            <div className={`mt-3 rounded-lg border ${mc.border} ${mc.bg}`}>
                              <button
                                className={`flex w-full items-center justify-between p-4 pb-2 cursor-pointer ${mc.hoverBg} rounded-t-lg transition-colors`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setCollapsedAiConfig((prev) => {
                                    const next = new Set(prev);
                                    const key = `multi-${dosar.numar}`;
                                    if (next.has(key)) next.delete(key);
                                    else next.add(key);
                                    return next;
                                  });
                                }}
                              >
                                <h4 className={`flex items-center gap-1.5 text-sm font-semibold ${mc.text}`}>
                                  <Bot className="h-3.5 w-3.5" /> Analiză AI Avansată
                                  <span className="text-[10px] font-normal text-muted-foreground">(multi-agent)</span>
                                </h4>
                                <div className="flex items-center gap-1.5">
                                  {multiResult[dosar.numar] && (
                                    <button
                                      className="p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900/30 text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                                      title="Exportă PDF"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const r = multiResult[dosar.numar];
                                        exportAnalysisPDF(
                                          dosar.numar, dosar.institutie, dosar.obiect,
                                          r.final, "advanced",
                                          JUDGE_MODELS_LIST.find((j) => j.key === r.judge.model)?.label || r.judge.model
                                        );
                                      }}
                                    >
                                      <Download className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                  <ChevronDown className={`h-4 w-4 ${mc.chevron} transition-transform ${collapsedAiConfig.has(`multi-${dosar.numar}`) ? "rotate-180" : ""}`} />
                                </div>
                              </button>
                              {collapsedAiConfig.has(`multi-${dosar.numar}`) && (
                                <div className="px-4 pb-4 space-y-3">
                                  {/* Model selectors */}
                                  <div className="flex flex-col gap-1.5">
                                    {/* Analyst 1 */}
                                    <div className={`flex items-center gap-0.5 rounded-lg border ${mc.selectBorder} bg-background p-0.5`}>
                                      <span className={`px-1.5 text-[11px] font-medium ${mc.selectLabel} w-20`}>Analist 1</span>
                                      {availableModels.map((m) => (
                                        <button
                                          key={m.key}
                                          onClick={(e) => { e.stopPropagation(); setMultiAnalysts((prev) => [m.key, prev[1]]); }}
                                          disabled={m.key === multiAnalysts[1]}
                                          className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                                            multiAnalysts[0] === m.key
                                              ? mc.selectActive
                                              : m.key === multiAnalysts[1]
                                                ? "text-muted-foreground/30 cursor-not-allowed"
                                                : "text-muted-foreground hover:text-foreground hover:bg-muted"
                                          }`}
                                        >
                                          {m.label}
                                        </button>
                                      ))}
                                      {(() => { const sel = availableModels.find((m) => m.key === multiAnalysts[0]); return sel ? <span className="px-1.5 text-[10px] text-muted-foreground">{sel.desc}</span> : null; })()}
                                    </div>
                                    {/* Analyst 2 */}
                                    <div className={`flex items-center gap-0.5 rounded-lg border ${mc.selectBorder} bg-background p-0.5`}>
                                      <span className={`px-1.5 text-[11px] font-medium ${mc.selectLabel} w-20`}>Analist 2</span>
                                      {availableModels.map((m) => (
                                        <button
                                          key={m.key}
                                          onClick={(e) => { e.stopPropagation(); setMultiAnalysts((prev) => [prev[0], m.key]); }}
                                          disabled={m.key === multiAnalysts[0]}
                                          className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                                            multiAnalysts[1] === m.key
                                              ? mc.selectActive
                                              : m.key === multiAnalysts[0]
                                                ? "text-muted-foreground/30 cursor-not-allowed"
                                                : "text-muted-foreground hover:text-foreground hover:bg-muted"
                                          }`}
                                        >
                                          {m.label}
                                        </button>
                                      ))}
                                      {(() => { const sel = availableModels.find((m) => m.key === multiAnalysts[1]); return sel ? <span className="px-1.5 text-[10px] text-muted-foreground">{sel.desc}</span> : null; })()}
                                    </div>
                                    {/* Judge */}
                                    <div className={`flex items-center gap-0.5 rounded-lg border ${mc.selectBorder} bg-background p-0.5`}>
                                      <span className={`px-1.5 text-[11px] font-medium ${mc.selectLabel} w-20`}>Judecător</span>
                                      {JUDGE_MODELS_LIST.filter((j) => {
                                        if (j.provider === "anthropic") return apiKeys?.anthropic;
                                        if (j.provider === "openai") return apiKeys?.openai;
                                        if (j.provider === "google") return apiKeys?.google;
                                        return false;
                                      }).map((j) => (
                                        <button
                                          key={j.key}
                                          onClick={(e) => { e.stopPropagation(); setMultiJudge(j.key); }}
                                          className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                                            multiJudge === j.key
                                              ? mc.selectActive
                                              : "text-muted-foreground hover:text-foreground hover:bg-muted"
                                          }`}
                                        >
                                          {j.label}
                                        </button>
                                      ))}
                                      {(() => { const sel = JUDGE_MODELS_LIST.find((j) => j.key === multiJudge); return sel ? <span className="px-1.5 text-[10px] text-muted-foreground">{sel.desc}</span> : null; })()}
                                    </div>
                                  </div>
                                  {/* Analyze button */}
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className={`gap-2 ${mc.btnBorder} ${mc.btnText} ${mc.btnHover}`}
                                    onClick={(e) => { e.stopPropagation(); handleMultiAnalyze(dosar); }}
                                    disabled={multiLoading === dosar.numar}
                                  >
                                    {multiLoading === dosar.numar ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Bot className="h-4 w-4" />
                                    )}
                                    {multiLoading === dosar.numar ? "Se analizează..." : multiResult[dosar.numar] ? "Re-analizează" : "Analizează"}
                                  </Button>
                                  {multiLoading === dosar.numar && (
                                    <p className={`text-sm ${mc.text} animate-pulse`}>
                                      <Loader2 className="inline h-3.5 w-3.5 mr-1 animate-spin" />
                                      Analistii analizeaza in paralel, apoi judecatorul reconciliaza...
                                    </p>
                                  )}
                                  {multiError && multiLoading === null && (
                                    <p className="text-sm text-destructive">{multiError}</p>
                                  )}
                                  {multiResult[dosar.numar] && (
                                    <div className="space-y-3">
                                      {/* Final judge analysis */}
                                      <div className={`rounded-lg border ${mc.border} ${mc.bg}`}>
                                        <div className="p-4 pb-2">
                                          <h4 className={`flex items-center gap-1.5 text-sm font-semibold ${mc.text}`}>
                                            <Bot className="h-3.5 w-3.5" /> Analiză AI Avansată (Judecător: {JUDGE_MODELS_LIST.find((j) => j.key === multiResult[dosar.numar].judge.model)?.label || multiResult[dosar.numar].judge.model})
                                          </h4>
                                        </div>
                                        <div className="prose prose-sm max-w-none text-sm leading-relaxed text-foreground dark:prose-invert px-4 pb-4 [&_strong]:font-semibold [&_strong]:text-foreground [&_h2]:text-sm [&_h2]:font-bold [&_h2]:mt-3 [&_h2]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_p]:my-1.5 [&_ul]:my-1 [&_li]:my-0.5">
                                          {multiResult[dosar.numar].final.split("\n").map((line, li) => {
                                            if (line.startsWith("## ")) return <h2 key={li}>{line.slice(3)}</h2>;
                                            if (line.startsWith("### ")) return <h3 key={li}>{line.slice(4)}</h3>;
                                            if (line.startsWith("**") && line.endsWith("**")) return <h3 key={li}>{line.slice(2, -2)}</h3>;
                                            if (line.startsWith("- ") || line.startsWith("* ")) {
                                              const content = line.slice(2);
                                              return <div key={li} className="flex gap-2 ml-2"><span className={mc.bullet}>•</span><span dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'), { ALLOWED_TAGS: ['strong', 'em', 'b', 'i'], ALLOWED_ATTR: [] }) }} /></div>;
                                            }
                                            if (line.match(/^\d+\.\s/)) {
                                              const content = line.replace(/^\d+\.\s/, "");
                                              const num = line.match(/^(\d+)\./)?.[1];
                                              return <div key={li} className="flex gap-2 ml-2"><span className={`font-semibold ${mc.num} min-w-[1.2em]`}>{num}.</span><span dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'), { ALLOWED_TAGS: ['strong', 'em', 'b', 'i'], ALLOWED_ATTR: [] }) }} /></div>;
                                            }
                                            if (line.trim() === "") return <div key={li} className="h-2" />;
                                            return <p key={li} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'), { ALLOWED_TAGS: ['strong', 'em', 'b', 'i'], ALLOWED_ATTR: [] }) }} />;
                                          })}
                                        </div>
                                      </div>
                                      {/* Toggle individual analyses */}
                                      <button
                                        className={`text-xs ${mc.link} ${mc.linkHover} underline`}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setShowIndividual((prev) => {
                                            const next = new Set(prev);
                                            if (next.has(dosar.numar)) next.delete(dosar.numar);
                                            else next.add(dosar.numar);
                                            return next;
                                          });
                                        }}
                                      >
                                        {showIndividual.has(dosar.numar) ? "Ascunde analizele individuale" : "Vezi analizele individuale"}
                                      </button>
                                      {showIndividual.has(dosar.numar) && (
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                          {[multiResult[dosar.numar].analyses.analyst1, multiResult[dosar.numar].analyses.analyst2].map((a, idx) => (
                                            <div key={idx} className="rounded-lg border border-muted bg-muted/30 p-3">
                                              <h5 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                                                Analist {idx + 1}: {AI_MODELS.find((m) => m.key === a.model)?.label || a.model}
                                              </h5>
                                              <div className="prose prose-sm max-w-none text-xs leading-relaxed text-muted-foreground [&_strong]:font-semibold [&_strong]:text-foreground [&_p]:my-1 max-h-[400px] overflow-y-auto">
                                                {a.text.split("\n").map((line, li) => {
                                                  if (line.startsWith("## ") || line.startsWith("### ") || (line.startsWith("**") && line.endsWith("**"))) return <h3 key={li} className="text-xs font-semibold mt-2 mb-0.5">{line.replace(/^#{2,3}\s|^\*\*|\*\*$/g, "")}</h3>;
                                                  if (line.startsWith("- ") || line.startsWith("* ")) return <div key={li} className="flex gap-1.5 ml-1"><span>•</span><span dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(line.slice(2).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'), { ALLOWED_TAGS: ['strong', 'em', 'b', 'i'], ALLOWED_ATTR: [] }) }} /></div>;
                                                  if (line.trim() === "") return <div key={li} className="h-1" />;
                                                  return <p key={li} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'), { ALLOWED_TAGS: ['strong', 'em', 'b', 'i'], ALLOWED_ATTR: [] }) }} />;
                                                })}
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex flex-col items-center gap-2 border-t border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(0)} disabled={page === 0}>
              «
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
              ‹ Inapoi
            </Button>
            <div className="flex items-center gap-1">
              {getPageNumbers(page, totalPages).map((p, i) =>
                p === "..." ? (
                  <span key={`dots-${i}`} className="px-1 text-sm text-muted-foreground">...</span>
                ) : (
                  <Button
                    key={p}
                    variant={p === page + 1 ? "default" : "outline"}
                    size="sm"
                    className="min-w-[32px]"
                    onClick={() => setPage((p as number) - 1)}
                  >
                    {p}
                  </Button>
                )
              )}
            </div>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}>
              Inainte ›
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPage(totalPages - 1)} disabled={page === totalPages - 1}>
              »
            </Button>
            <div className="flex items-center gap-1 ml-2">
              <span className="text-xs text-muted-foreground">Pagina</span>
              <input
                type="number"
                min={1}
                max={totalPages}
                value={page + 1}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (val >= 1 && val <= totalPages) setPage(val - 1);
                }}
                className="w-14 rounded border border-border bg-background px-2 py-1 text-center text-sm"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">Pagina {page + 1} din {totalPages}</span>
            <span className="text-xs text-muted-foreground">|</span>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Rezultate pe pagina:</span>
              {[10, 15, 25, 50, 100].map((size) => (
                <button
                  key={size}
                  onClick={() => { setPageSize(size); setPage(0); }}
                  className={`min-w-[32px] rounded px-2 py-0.5 text-xs border ${pageSize === size ? "bg-primary text-primary-foreground border-primary" : "border-border bg-background text-muted-foreground hover:bg-muted"}`}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function InfoItem({ icon: Icon, label, value }: { icon?: React.ElementType; label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        {Icon && <Icon className="h-3 w-3" />}{label}
      </p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

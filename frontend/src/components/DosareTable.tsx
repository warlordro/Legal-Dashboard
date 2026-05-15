import { useState, useEffect, useRef, useCallback, Fragment } from "react";
import {
  ChevronDown,
  ChevronUp,
  FileText,
  Download,
  ExternalLink,
  Users,
  Calendar,
  Building2,
  Scale,
  FileCheck,
  Eye,
  Activity,
  Loader2,
} from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Card } from "./ui/card";
import { formatDate, parseSqliteUtc, splitConcatenatedWords, formatDocumentSedinta } from "@/lib/utils";
import { api, monitoring, MonitoringApiError } from "@/lib/api";
import type { Dosar } from "@/types";
import { exportAnalysisPDF } from "@/lib/export-analysis";
import { TablePagination } from "@/components/table-pagination";
import { AI_MODELS } from "@/components/dosare-ai-config";
import { DosareAiAnalysisPanel } from "@/components/dosare-ai-analysis-panel";
import { stripDiacritics, HighlightName } from "@/components/dosare-table-highlight";
import {
  getStadiuBadgeColor,
  getCategorieBadgeColor,
  getSolutieBadgeVariant,
  formatInstitutie,
  getPortalJustUrl,
} from "@/components/dosare-table-helpers";

interface ApiKeys {
  anthropic: string;
  openai: string;
  google: string;
}

interface DosareTableProps {
  dosare: Dosar[];
  onExportExcel: (selected?: Dosar[]) => Promise<void> | void;
  onExportPDF: (selected?: Dosar[]) => Promise<void> | void;
  searchedName?: string;
  apiKeys?: ApiKeys;
  onConfigureApiKey?: () => void;
}

type SortKey = "numar" | "data" | "institutie";

export function DosareTable({
  dosare,
  onExportExcel,
  onExportPDF,
  searchedName,
  apiKeys,
  onConfigureApiKey: _onConfigureApiKey,
}: DosareTableProps) {
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
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | null>(null);
  const [_hiddenAnalysis, _setHiddenAnalysis] = useState<Set<string>>(new Set());
  const [collapsedAiConfig, setCollapsedAiConfig] = useState<Set<string>>(new Set());
  // Per-dosar monitor state: pending = request in flight, "added" / "exists" /
  // error message. Lives in component state so feedback is local to the row;
  // the global Monitorizare page is the source of truth and is refreshed on visit.
  const [monitorState, setMonitorState] = useState<Record<string, "pending" | "added" | "exists" | string>>({});
  const expandedDetailRef = useRef<HTMLTableRowElement>(null);

  const handleMonitor = useCallback(
    async (numar: string) => {
      if (!numar || monitorState[numar] === "pending") return;
      setMonitorState((prev) => ({ ...prev, [numar]: "pending" }));
      try {
        // client_request_id makes a double-click idempotent: backend returns the
        // existing row instead of erroring or creating a duplicate.
        const reqId = `dosar-${numar}-${Date.now()}`;
        const job = await monitoring.createDosar({
          numar_dosar: numar,
          client_request_id: reqId,
        });
        // The backend returns 201 on fresh insert and 200 on target_hash collision;
        // both are exposed as the same shape here, so we infer "exists" when the
        // job's created_at predates the request by more than a few seconds.
        const wasJustCreated = Date.now() - parseSqliteUtc(job.created_at).getTime() < 5000;
        setMonitorState((prev) => ({
          ...prev,
          [numar]: wasJustCreated ? "added" : "exists",
        }));
      } catch (err) {
        const msg = err instanceof MonitoringApiError ? err.message : err instanceof Error ? err.message : "Eroare";
        setMonitorState((prev) => ({ ...prev, [numar]: msg }));
      }
    },
    [monitorState]
  );

  // Track viewed (expanded) dosare — persist in sessionStorage
  const [viewedDosare, setViewedDosare] = useState<Set<string>>(() => {
    try {
      const saved = sessionStorage.getItem("viewedDosare");
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });

  const markAsViewed = useCallback((numar: string) => {
    setViewedDosare((prev) => {
      if (prev.has(numar)) return prev;
      const next = new Set(prev);
      next.add(numar);
      try {
        sessionStorage.setItem("viewedDosare", JSON.stringify([...next]));
      } catch {
        /* sessionStorage unavailable; visited-markers are best-effort */
      }
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
        if ((style.overflowY === "auto" || style.overflowY === "scroll") && parent.scrollHeight > parent.clientHeight) {
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
  const [_multiMode, _setMultiMode] = useState(false);
  const [multiAnalysts, setMultiAnalysts] = useState<[string, string]>(["claude-sonnet", "gpt-5.4-mini"]);
  const [multiJudge, setMultiJudge] = useState<string>("claude-opus");
  const [multiLoading, setMultiLoading] = useState<string | null>(null);
  const [multiResult, setMultiResult] = useState<
    Record<
      string,
      {
        analyses: { analyst1: { model: string; text: string }; analyst2: { model: string; text: string } };
        judge: { model: string; text: string };
        final: string;
      }
    >
  >({});
  const [multiError, setMultiError] = useState<string | null>(null);
  const [multiPhase, setMultiPhase] = useState<
    Record<string, Set<"analyst1_done" | "analyst2_done" | "judge_started">>
  >({});
  const [showIndividual, setShowIndividual] = useState<Set<string>>(new Set());

  const hasAnyKey = apiKeys && (apiKeys.anthropic || apiKeys.openai || apiKeys.google);

  // Filter to only show models with active keys
  const availableModels = AI_MODELS.filter((m) => {
    if (m.provider === "anthropic") return apiKeys?.anthropic;
    if (m.provider === "openai") return apiKeys?.openai;
    if (m.provider === "google") return apiKeys?.google;
    return false;
  });

  // Group available models by provider
  const providerGroups = availableModels.reduce(
    (acc, m) => {
      if (!acc[m.provider]) acc[m.provider] = [];
      acc[m.provider].push(m);
      return acc;
    },
    {} as Record<string, typeof AI_MODELS>
  );

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
    if (!hasAnyKey) {
      setShowKeyPrompt(true);
      return;
    }
    // Check required provider keys
    const neededProviders = new Set<string>();
    for (const m of [...multiAnalysts, multiJudge]) {
      const modelDef = AI_MODELS.find((mod) => mod.key === m);
      if (modelDef) neededProviders.add(modelDef.provider);
    }
    for (const provider of neededProviders) {
      if (provider === "anthropic" && !apiKeys?.anthropic) {
        setMultiError("Lipseste cheia API pentru Anthropic (Claude)");
        return;
      }
      if (provider === "openai" && !apiKeys?.openai) {
        setMultiError("Lipseste cheia API pentru OpenAI (GPT)");
        return;
      }
      if (provider === "google" && !apiKeys?.google) {
        setMultiError("Lipseste cheia API pentru Google (Gemini)");
        return;
      }
    }
    setMultiLoading(dosar.numar);
    setMultiError(null);
    setMultiPhase((prev) => ({ ...prev, [dosar.numar]: new Set() }));
    try {
      const result = await api.ai.analyzeMulti(dosar, multiAnalysts, multiJudge, apiKeys, (phase) => {
        setMultiPhase((prev) => {
          const next = new Set(prev[dosar.numar] ?? []);
          next.add(phase);
          return { ...prev, [dosar.numar]: next };
        });
      });
      setMultiResult((prev) => ({ ...prev, [dosar.numar]: result }));
    } catch (err: unknown) {
      setMultiError(err instanceof Error ? err.message : "Eroare la analiza avansata");
    } finally {
      setMultiLoading(null);
      setMultiPhase((prev) => {
        const { [dosar.numar]: _, ...rest } = prev;
        return rest;
      });
    }
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
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
    sortKey === k ? sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" /> : null;

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
        for (const d of paged) next.delete(d.numar);
      } else {
        for (const d of paged) next.add(d.numar);
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
            <span className="text-xs text-violet-600 font-medium ml-1">({selected.size} selectate)</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground underline"
              onClick={() => setSelected(new Set())}
            >
              Deselecteaza tot
            </button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={exporting !== null}
            onClick={async () => {
              setExporting("xlsx");
              try {
                await onExportExcel(getExportDosare());
              } catch (e) {
                console.error("[dosare] export xlsx failed:", e);
              } finally {
                setExporting(null);
              }
            }}
          >
            {exporting === "xlsx" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}{" "}
            Excel {selected.size > 0 ? `(${selected.size})` : ""}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={exporting !== null}
            onClick={async () => {
              setExporting("pdf");
              try {
                await onExportPDF(getExportDosare());
              } catch (e) {
                console.error("[dosare] export pdf failed:", e);
              } finally {
                setExporting(null);
              }
            }}
          >
            {exporting === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} PDF{" "}
            {selected.size > 0 ? `(${selected.size})` : ""}
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
                  className="h-4 w-4 rounded border-border accent-blue-600 cursor-pointer"
                  title="Selecteaza/deselecteaza pagina curenta"
                />
              </th>
              {([["numar", "Numar Dosar"]] as [SortKey, string][]).map(([key, label]) => (
                <th
                  key={key}
                  className="cursor-pointer px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                  onClick={() => toggleSort(key)}
                >
                  <span className="flex items-center gap-1">
                    {label} <SortIcon k={key} />
                  </span>
                </th>
              ))}
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Categorie
              </th>
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
                  <span className="flex items-center gap-1">
                    {label} <SortIcon k={key} />
                  </span>
                </th>
              ))}
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Parti
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Sedinte
              </th>
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
                        className="h-4 w-4 rounded border-border accent-blue-600 cursor-pointer"
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
                          <span title="Vizualizat">
                            <Eye className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                          </span>
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
                        ) : (
                          "-"
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        {dosar.categorieCaz && (
                          <Badge variant="outline" className={`text-xs ${getCategorieBadgeColor(dosar.categorieCaz)}`}>
                            {dosar.categorieCaz}
                          </Badge>
                        )}
                        {dosar.stadiuProcesual && (
                          <Badge variant="outline" className={`text-xs ${getStadiuBadgeColor(dosar.stadiuProcesual)}`}>
                            {dosar.stadiuProcesual}
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td
                      className={`px-4 py-3 text-[13px] whitespace-nowrap ${isExpanded ? "font-bold text-red-800 dark:text-red-400" : "text-foreground"}`}
                    >
                      {formatDate(dosar.data)}
                    </td>
                    <td
                      className={`px-4 py-3 text-[13px] max-w-[220px] truncate ${isExpanded ? "font-bold text-red-800 dark:text-red-400" : ""}`}
                      title={formatInstitutie(dosar.institutie)}
                    >
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
                      {dosar.sedinte.length > 0 ? (
                        <Badge variant="secondary" className="text-[11px]">
                          {dosar.sedinte.length}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
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
                          {/* Action bar — Monitorizeaza adauga dosarul in /monitorizare */}
                          {dosar.numar &&
                            (() => {
                              const state = monitorState[dosar.numar];
                              const isPending = state === "pending";
                              const isAdded = state === "added";
                              const isExists = state === "exists";
                              const errorMsg = state && !["pending", "added", "exists"].includes(state) ? state : null;
                              return (
                                <div className="flex items-center gap-2">
                                  <Button
                                    variant={isAdded || isExists ? "secondary" : "outline"}
                                    size="sm"
                                    disabled={isPending || isAdded || isExists}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleMonitor(dosar.numar);
                                    }}
                                  >
                                    <Activity className="h-4 w-4" />
                                    {isPending
                                      ? "Se adauga..."
                                      : isAdded
                                        ? "Adaugat la monitorizare"
                                        : isExists
                                          ? "Deja monitorizat"
                                          : "Monitorizeaza schimbari"}
                                  </Button>
                                  {errorMsg && <span className="text-xs text-red-600">{errorMsg}</span>}
                                </div>
                              );
                            })()}

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
                                      <Badge variant="outline" className="shrink-0 text-xs">
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
                                        <span className="block font-mono text-[11px] text-muted-foreground">
                                          {s.ora}
                                        </span>
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
                                            <p
                                              className="leading-relaxed text-foreground"
                                              style={{ fontSize: "14.5px" }}
                                            >
                                              {s.solutieSumar}
                                            </p>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          <DosareAiAnalysisPanel
                            dosar={dosar}
                            apiKeys={apiKeys}
                            ai={{
                              analysis: aiAnalysis,
                              loading: aiLoading,
                              error: aiError,
                              model: aiModel,
                              setModel: setAiModel,
                              showKeyPrompt,
                              hasAnyKey: !!hasAnyKey,
                              availableModels,
                              providerGroups,
                              collapsed: collapsedAiConfig,
                              toggleCollapsed: (key: string) =>
                                setCollapsedAiConfig((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(key)) next.delete(key);
                                  else next.add(key);
                                  return next;
                                }),
                              onAnalyze: handleAiAnalyze,
                            }}
                            multi={{
                              analysts: multiAnalysts,
                              setAnalysts: setMultiAnalysts,
                              judge: multiJudge,
                              setJudge: setMultiJudge,
                              loading: multiLoading,
                              phase: multiPhase[dosar.numar],
                              result: multiResult,
                              error: multiError,
                              showIndividual,
                              toggleIndividual: (numar: string) =>
                                setShowIndividual((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(numar)) next.delete(numar);
                                  else next.add(numar);
                                  return next;
                                }),
                              onAnalyze: handleMultiAnalyze,
                            }}
                          />
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
        <TablePagination
          page={page}
          totalPages={totalPages}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(0);
          }}
        />
      )}
    </Card>
  );
}

function InfoItem({ icon: Icon, label, value }: { icon?: React.ElementType; label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

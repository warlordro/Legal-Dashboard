import { useState, useEffect, useRef, Fragment } from "react";
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
import { formatDate, formatDocumentSedinta } from "@/lib/utils";
import type { Dosar } from "@/types";
import { exportAnalysisPDF } from "@/lib/export-analysis";
import { TablePagination } from "@/components/table-pagination";
import type { AiMode } from "@/components/dosare-ai-config";
import { DosareAiAnalysisPanel } from "@/components/dosare-ai-analysis-panel";
import { stripDiacritics, HighlightName } from "@/components/dosare-table-highlight";
import {
  getStadiuBadgeColor,
  getCategorieBadgeColor,
  getSolutieBadgeVariant,
  formatInstitutie,
  getDosarExternalUrl,
} from "@/components/dosare-table-helpers";
import { api } from "@/lib/api";
import { useViewedDosareSession } from "@/hooks/useViewedDosareSession";
import { useDosareSelection } from "@/hooks/useDosareSelection";
import { useMonitorRowState } from "@/hooks/useMonitorRowState";
import { useDosareAi } from "@/hooks/useDosareAi";

interface ApiKeys {
  anthropic: string;
  openai: string;
  google: string;
  openrouter: string;
}

interface DosareTableProps {
  dosare: Dosar[];
  onExportExcel: (selected?: Dosar[]) => Promise<void> | void;
  onExportPDF: (selected?: Dosar[]) => Promise<void> | void;
  searchedName?: string;
  apiKeys?: ApiKeys;
  aiSettings: { mode: AiMode };
  onConfigureApiKey?: () => void;
}

type SortKey = "numar" | "data" | "institutie";

export function DosareTable({
  dosare,
  onExportExcel,
  onExportPDF,
  searchedName,
  apiKeys,
  aiSettings,
  onConfigureApiKey: _onConfigureApiKey,
}: DosareTableProps) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("data");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | null>(null);
  const expandedDetailRef = useRef<HTMLTableRowElement>(null);
  // ICCJ search results are enriched server-side (categorie + party roles + sedinte).
  // We only lazy-fetch detail for a row that arrived UN-enriched — e.g. a server-side
  // enrich that failed for that one dosar. The expanded view falls back to the row's own
  // data when there is no cached detail, so an already-enriched row needs no fetch.
  const [iccjDetails, setIccjDetails] = useState<Record<string, Dosar>>({});
  const [iccjDetailLoading, setIccjDetailLoading] = useState<string | null>(null);

  const ensureIccjDetail = (dosar: Dosar) => {
    if (dosar.source !== "iccj" || !dosar.iccjId) return;
    const alreadyEnriched =
      !!dosar.categorieCaz || dosar.sedinte.length > 0 || dosar.parti.some((p) => p.calitateParte);
    if (alreadyEnriched) return;
    if (iccjDetails[dosar.iccjId] || iccjDetailLoading === dosar.iccjId) return;
    const id = dosar.iccjId;
    setIccjDetailLoading(id);
    api.dosare
      .detaliuIccj(id)
      .then((res) => setIccjDetails((prev) => ({ ...prev, [id]: res.data })))
      .catch((e) => console.error("[iccj] detaliu fetch failed:", e))
      .finally(() => setIccjDetailLoading((cur) => (cur === id ? null : cur)));
  };

  const { monitorState, handleMonitor } = useMonitorRowState();
  const { viewedDosare, markAsViewed } = useViewedDosareSession();
  const { ai, multiForRow } = useDosareAi({ apiKeys, aiSettings });

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
    // numeric:true — numerele de dosar ("100/1/2026" vs "99/1/2026") se
    // compara natural, nu lexicografic; inofensiv pentru coloanele text.
    return sortDir === "asc"
      ? av.localeCompare(bv, undefined, { numeric: true })
      : bv.localeCompare(av, undefined, { numeric: true });
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

  const { selected, toggleSelect, toggleSelectAll, clearSelection, allPageSelected } = useDosareSelection(paged);

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
              onClick={clearSelection}
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
                // biome-ignore lint/a11y/useKeyWithClickEvents: <th> nu primeste focus de tastatura nativ; sortarea e expusa si prin meniul de filtru/sort din toolbar.
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
                // biome-ignore lint/a11y/useKeyWithClickEvents: <th> nu primeste focus de tastatura nativ; sortarea e expusa si prin meniul de filtru/sort din toolbar.
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
              // For ICCJ, prefer the lazily-fetched full detail in the expanded view.
              const detailDosar: Dosar =
                dosar.source === "iccj" && dosar.iccjId && iccjDetails[dosar.iccjId]
                  ? iccjDetails[dosar.iccjId]
                  : dosar;
              const detailLoading = dosar.source === "iccj" && !!dosar.iccjId && iccjDetailLoading === dosar.iccjId;
              return (
                <Fragment key={`dosar-${dosar.numar}-${i}`}>
                  {/* biome-ignore lint/a11y/useKeyWithClickEvents: <tr> nu primeste focus de tastatura; expandarea e expusa si prin butoanele inline (chevron + actions). */}
                  <tr
                    className={`transition-colors cursor-pointer hover:bg-muted/30 ${isExpanded ? "bg-muted/40" : ""} ${selected.has(dosar.numar) ? "bg-violet-50 dark:bg-violet-900/10" : ""}`}
                    onClick={() => {
                      setExpandedIdx(isExpanded ? null : globalIdx);
                      if (!isExpanded && dosar.numar) markAsViewed(dosar.numar);
                      if (!isExpanded) ensureIccjDetail(dosar);
                    }}
                  >
                    {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation pe celula checkbox impiedica expand-ul liniei; tastatura merge prin checkbox. */}
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
                        {dosar.source === "iccj" && (
                          <Badge
                            variant="outline"
                            className="shrink-0 border-amber-300 bg-amber-50 text-[10px] text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400"
                            title="Inalta Curte de Casatie si Justitie"
                          >
                            ICCJ
                          </Badge>
                        )}
                        {dosar.numar ? (
                          <a
                            href={getDosarExternalUrl(dosar)}
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
                                      handleMonitor(dosar.numar, dosar.source, dosar.iccjId);
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

                          {detailLoading && (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Se incarca detaliile de la ICCJ...
                            </div>
                          )}

                          {/* Info grid */}
                          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                            <InfoItem icon={Calendar} label="Data Dosar" value={formatDate(detailDosar.data)} />
                            <InfoItem icon={Building2} label="Departament" value={detailDosar.departament || "-"} />
                            <InfoItem icon={Scale} label="Categorie" value={detailDosar.categorieCaz || "-"} />
                            <InfoItem label="Stadiu" value={detailDosar.stadiuProcesual || "-"} />
                          </div>

                          {detailDosar.obiect && (
                            <div>
                              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Obiect Dosar
                              </h4>
                              <p className="text-sm">{detailDosar.obiect}</p>
                            </div>
                          )}

                          {/* Parti */}
                          {detailDosar.parti.length > 0 && (
                            <div>
                              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                <Users className="h-3.5 w-3.5" /> Parti ({detailDosar.parti.length})
                              </h4>
                              <div className="grid gap-1 rounded-lg border border-border bg-background p-3 sm:grid-cols-2">
                                {detailDosar.parti.map((p, j) => {
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
                          {detailDosar.sedinte.length > 0 && (
                            <div>
                              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                <Calendar className="h-3.5 w-3.5" /> Sedinte ({detailDosar.sedinte.length})
                              </h4>
                              <div className="relative space-y-0">
                                {/* Timeline line */}
                                <div className="absolute left-[92px] top-0 bottom-0 w-px bg-border" />
                                {detailDosar.sedinte.map((s, j) => (
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

                          {/* Cai de atac (ICCJ) */}
                          {detailDosar.caiAtac && detailDosar.caiAtac.length > 0 && (
                            <div>
                              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                <Scale className="h-3.5 w-3.5" /> Cai de atac ({detailDosar.caiAtac.length})
                              </h4>
                              <div className="grid gap-1 rounded-lg border border-border bg-background p-3">
                                {detailDosar.caiAtac.map((c, j) => (
                                  <div key={j} className="flex flex-wrap items-center gap-1.5 text-xs">
                                    <span className="font-mono text-muted-foreground">
                                      {formatDate(c.dataDeclarare)}
                                    </span>
                                    <Badge variant="outline" className="text-[11px]">
                                      {c.tipCaleAtac}
                                    </Badge>
                                    <span className="truncate" title={c.parteDeclaratoare}>
                                      {c.parteDeclaratoare}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          <DosareAiAnalysisPanel
                            dosar={detailDosar}
                            apiKeys={apiKeys}
                            ai={ai}
                            multi={multiForRow(dosar.numar)}
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

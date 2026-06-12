import { useState, useEffect, useRef, useCallback } from "react";
import { Download, CalendarDays, ExternalLink, ChevronDown, ChevronUp, Eye, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Card } from "./ui/card";
import { formatDate, formatDocumentSedinta, parseSqliteUtc } from "@/lib/utils";
import type { Termen } from "@/types";
import { normalizeInstitutie } from "@/lib/institutii";
import { TablePagination } from "@/components/table-pagination";
import { TermeneExpandedDetail } from "./termene-table-detail-row";
import { getDosarExternalUrl } from "./dosare-table-helpers";
import { monitoring, MonitoringApiError } from "@/lib/api";

interface TermeneTableProps {
  termene: Termen[];
  onExportExcel: (selected?: Termen[]) => Promise<void> | void;
  onExportPDF: (selected?: Termen[]) => Promise<void> | void;
  searchedName?: string;
}

function formatInstitutie(raw: string): string {
  if (!raw) return "-";
  return normalizeInstitutie(raw);
}

export function TermeneTable({ termene, onExportExcel, onExportPDF, searchedName }: TermeneTableProps) {
  const [page, setPage] = useState(0);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | null>(null);
  const [lastExpandedKey, setLastExpandedKey] = useState<string | null>(null);
  const expandedDetailRef = useRef<HTMLTableRowElement>(null);

  // Track viewed (expanded) termene — persist in sessionStorage
  const [viewedTermene, setViewedTermene] = useState<Set<string>>(() => {
    try {
      const saved = sessionStorage.getItem("viewedTermene");
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });

  // Per-numarDosar monitor state. Keyed by numarDosar (not by row) so opening
  // multiple termene of the same dosar shares the "Deja monitorizat" feedback.
  const [monitorState, setMonitorState] = useState<Record<string, "pending" | "added" | "exists" | string>>({});

  const handleMonitor = useCallback(
    async (numar: string) => {
      if (!numar || monitorState[numar] === "pending") return;
      setMonitorState((prev) => ({ ...prev, [numar]: "pending" }));
      try {
        const reqId = `termen-${numar}-${Date.now()}`;
        const job = await monitoring.createDosar({
          numar_dosar: numar,
          client_request_id: reqId,
        });
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

  const markAsViewed = useCallback((numarDosar: string) => {
    setViewedTermene((prev) => {
      if (prev.has(numarDosar)) return prev;
      const next = new Set(prev);
      next.add(numarDosar);
      try {
        sessionStorage.setItem("viewedTermene", JSON.stringify([...next]));
      } catch {
        /* sessionStorage unavailable; visited-markers are best-effort */
      }
      return next;
    });
  }, []);

  const toggleRow = (key: string, numarDosar?: string) => {
    setExpandedRows((prev) => {
      if (prev.has(key)) {
        setLastExpandedKey(null);
        return new Set();
      }
      setLastExpandedKey(key);
      if (numarDosar) markAsViewed(numarDosar);
      return new Set([key]);
    });
  };

  // Auto-scroll to expanded row details
  useEffect(() => {
    if (!lastExpandedKey) return;
    const timer = setTimeout(() => {
      const el = expandedDetailRef.current;
      if (!el) return;
      let parent = el.parentElement as HTMLElement | null;
      while (parent) {
        const style = getComputedStyle(parent);
        if ((style.overflowY === "auto" || style.overflowY === "scroll") && parent.scrollHeight > parent.clientHeight) {
          const elRect = el.getBoundingClientRect();
          const parentRect = parent.getBoundingClientRect();
          if (elRect.bottom > parentRect.bottom || elRect.top < parentRect.top) {
            parent.scrollTo({
              top: parent.scrollTop + (elRect.top - parentRect.top) - 80,
              behavior: "smooth",
            });
          }
          return;
        }
        parent = parent.parentElement;
      }
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 50);
    return () => clearTimeout(timer);
  }, [lastExpandedKey]);

  const toggleSelect = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Stable compound key — survives filter/sort/reorder. Positional keys (page*pageSize+i)
  // silently select the wrong row when the underlying list changes.
  const getTermenKey = (t: Termen) => `${t.numarDosar}|${t.data}|${t.ora}|${t.complet}`;

  const toggleSelectAll = () => {
    const pageKeys = paged.map(getTermenKey);
    const allSelected = pageKeys.every((k) => selected.has(k));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const k of pageKeys) next.delete(k);
      } else {
        for (const k of pageKeys) next.add(k);
      }
      return next;
    });
  };

  const getExportTermene = (): Termen[] | undefined => {
    if (selected.size === 0) return undefined;
    const byKey = new Map(termene.map((t) => [getTermenKey(t), t]));
    return Array.from(selected)
      .map((k) => byKey.get(k))
      .filter((t): t is Termen => Boolean(t));
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const isViitor = (dateStr: string) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    return !Number.isNaN(d.getTime()) && d >= today;
  };

  const totalPages = Math.ceil(termene.length / pageSize);

  // Clamp page when list shrinks (filters reduce count below current page bounds).
  // Without this, the table renders empty — results exist but on a page that no longer exists.
  useEffect(() => {
    if (totalPages > 0 && page >= totalPages) setPage(0);
  }, [totalPages, page]);

  const paged = termene.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">{termene.length} termene gasite</span>
          {selected.size > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground"
              onClick={() => setSelected(new Set())}
            >
              Deselecteaza tot
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={exporting !== null}
            onClick={async () => {
              setExporting("xlsx");
              try {
                await onExportExcel(getExportTermene());
              } catch (e) {
                console.error("[termene] export xlsx failed:", e);
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
                await onExportPDF(getExportTermene());
              } catch (e) {
                console.error("[termene] export pdf failed:", e);
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
              <th className="w-10 px-2 py-3 text-center">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 accent-blue-600"
                  checked={paged.length > 0 && paged.every((t) => selected.has(getTermenKey(t)))}
                  onChange={toggleSelectAll}
                />
              </th>
              {["Numar Dosar", "Data", "Ora", "Institutie", "Complet", "Solutie"].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {paged.map((t, i) => {
              const rowKey = `${t.numarDosar}-${t.data}-${i}`;
              const selectKey = getTermenKey(t);
              const isExpanded = expandedRows.has(rowKey);
              const isSelected = selected.has(selectKey);
              const hasParts = t.parti && t.parti.length > 0;
              const hasDetails =
                hasParts ||
                t.categorieCaz ||
                t.stadiuProcesual ||
                t.obiect ||
                t.solutie ||
                t.solutieSumar ||
                Boolean(t.numarDosar);

              return (
                <>
                  {/* biome-ignore lint/a11y/useKeyWithClickEvents: <tr> nu primeste focus de tastatura; expandarea termenului e expusa si prin butoanele de actiune. */}
                  <tr
                    key={rowKey}
                    onClick={() => hasDetails && toggleRow(rowKey, t.numarDosar)}
                    className={`transition-colors hover:bg-muted/30 ${isViitor(t.data) ? "bg-primary/5" : ""} ${hasDetails ? "cursor-pointer" : ""} ${isSelected ? "bg-violet-50 dark:bg-violet-900/10" : ""}`}
                  >
                    {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation pe celula checkbox impiedica expand-ul liniei; tastatura merge prin checkbox. */}
                    <td className="w-10 px-2 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-gray-300 accent-blue-600"
                        checked={isSelected}
                        onChange={() => toggleSelect(selectKey)}
                      />
                    </td>
                    <td className="px-4 py-3 font-mono text-sm font-semibold">
                      <div className="flex items-center gap-2">
                        {hasDetails && (
                          <span className="text-muted-foreground">
                            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </span>
                        )}
                        {t.numarDosar && !viewedTermene.has(t.numarDosar) ? (
                          <span className="relative flex h-2.5 w-2.5 shrink-0" title="Nevizualizat">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
                            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-blue-500" />
                          </span>
                        ) : t.numarDosar && viewedTermene.has(t.numarDosar) ? (
                          <span title="Vizualizat">
                            <Eye className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                          </span>
                        ) : null}
                        {t.numarDosar ? (
                          <a
                            href={getDosarExternalUrl({ numar: t.numarDosar, source: t.source, iccjId: t.iccjId })}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1.5 text-primary hover:text-primary/80 hover:underline"
                          >
                            {t.numarDosar}
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                        ) : (
                          "-"
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`text-[13px] ${isExpanded ? "font-bold text-red-800 dark:text-red-400" : "text-foreground"}`}
                        >
                          {formatDate(t.data)}
                        </span>
                        {isViitor(t.data) && (
                          <Badge variant="success" className="text-[11px]">
                            Viitor
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td
                      className={`px-4 py-3 text-[13px] ${isExpanded ? "font-bold text-red-800 dark:text-red-400" : "text-muted-foreground"}`}
                    >
                      {t.ora || "-"}
                    </td>
                    <td
                      className={`px-4 py-3 text-[13px] max-w-[220px] truncate ${isExpanded ? "font-bold text-red-800 dark:text-red-400" : ""}`}
                      title={normalizeInstitutie(t.institutie)}
                    >
                      {formatInstitutie(t.institutie)}
                    </td>
                    <td className="px-4 py-3 text-[13px]">{t.complet || "-"}</td>
                    <td className="px-4 py-3 text-[13px] max-w-[250px]">
                      {t.solutie ? (
                        <div>
                          <p className="font-medium">{formatDocumentSedinta(t.solutie)}</p>
                          {t.solutieSumar && (
                            <p className="text-muted-foreground truncate" title={t.solutieSumar}>
                              {t.solutieSumar}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                  </tr>
                  {isExpanded && hasDetails && (
                    <tr
                      key={`${rowKey}-detail`}
                      ref={lastExpandedKey === rowKey ? expandedDetailRef : undefined}
                      className="bg-muted/20"
                    >
                      <td colSpan={7} className="px-4 py-4">
                        <TermeneExpandedDetail
                          termen={t}
                          searchedName={searchedName}
                          monitorState={t.numarDosar ? monitorState[t.numarDosar] : undefined}
                          onMonitor={handleMonitor}
                        />
                      </td>
                    </tr>
                  )}
                </>
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
          pageSizes={[10, 20, 50, 100]}
        />
      )}
    </Card>
  );
}

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, Download, ArrowUp, ArrowDown, ArrowUpDown, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { exportRnpmExcel, exportRnpmPDF } from "@/lib/rnpmExport";
import { getRnpmAvizStatusDisplay } from "@/lib/rnpmAvizStatus";
import { RnpmAvizDetailContent } from "./RnpmDetailModal";
import { TablePagination } from "@/components/table-pagination";
import { useRnpmResultsFilter } from "@/hooks/useRnpmResultsFilter";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { tokenizeFilterQuery } from "@/lib/rnpmFilterTokens";
import { highlightTokens, anyTokenMatches } from "@/lib/rnpmHighlightTokens";
import type { RnpmDocument } from "@/types/rnpm";

export interface RnpmResultsTableResult {
  searchId?: number | null;
  total: number;
  pagesTotal: number;
  pageSize: number;
  criteriu: string;
  documents: RnpmDocument[];
  avizIds: (number | null)[];
  nextRnpmPage: number | null;
}

export interface RnpmResultsTableProps {
  result: RnpmResultsTableResult | null;
  loading: boolean;
  onNeedMore: () => void;
  onOpenDetail: (doc: RnpmDocument, avizId: number | null) => void;
  searchType?: string;
  dateStart?: string; // YYYY-MM-DD
  dateEnd?: string; // YYYY-MM-DD
  elapsedMs?: number | null;
}

type SortKey = "no" | "identificator" | "data" | "tip" | "status" | "utilizator";
type SortDir = "asc" | "desc";

function parseRoDate(s: string): number {
  if (!s) return 0;
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (m) {
    const d = Number.parseInt(m[1], 10);
    const mo = Number.parseInt(m[2], 10);
    let y = Number.parseInt(m[3], 10);
    if (y < 100) y += 2000;
    return new Date(y, mo - 1, d).getTime();
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const min = Math.floor(s / 60);
  const rem = Math.round(s - min * 60);
  return `${min}m ${rem}s`;
}

export function RnpmResultsTable({
  result,
  loading,
  onNeedMore,
  onOpenDetail,
  searchType,
  dateStart,
  dateEnd,
  elapsedMs,
}: RnpmResultsTableProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const expandedDetailRef = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    if (!expandedId) return;
    const el = expandedDetailRef.current;
    if (!el) return;
    // App layout scrolls <main>, not window.
    const scroller = (el.closest("main") as HTMLElement | null) ?? (document.scrollingElement as HTMLElement | null);
    let lastH = 0;
    const doScroll = () => {
      const row = el.previousElementSibling as HTMLElement | null;
      if (!row || !scroller) return;
      const rowRect = row.getBoundingClientRect();
      const detailRect = el.getBoundingClientRect();
      const total = rowRect.height + detailRect.height;
      const scrollerRect = scroller.getBoundingClientRect();
      const viewH = scroller.clientHeight;
      // If row+detail fits, center it; otherwise anchor row near the top so the detail fills the viewport below.
      const targetRowTop = total <= viewH ? (viewH - total) / 2 : 16;
      const delta = rowRect.top - scrollerRect.top - targetRowTop;
      scroller.scrollBy({ top: delta, behavior: "smooth" });
    };
    // Fire once immediately in case the detail is already sized from a previous expand.
    doScroll();
    const ro = new ResizeObserver(() => {
      const h = el.getBoundingClientRect().height;
      if (Math.abs(h - lastH) < 4) return;
      lastH = h;
      doScroll();
    });
    ro.observe(el);
    const timeout = setTimeout(() => ro.disconnect(), 2500);
    return () => {
      ro.disconnect();
      clearTimeout(timeout);
    };
  }, [expandedId]);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [sortKey, setSortKey] = useState<SortKey>("no");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filterQuery, setFilterQuery] = useState("");
  const tableRef = useRef<HTMLDivElement>(null);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(0);
  };

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
    return sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  };

  const [viewedRnpm, setViewedRnpm] = useState<Set<string>>(() => {
    try {
      const saved = sessionStorage.getItem("viewedRnpm");
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });

  const markAsViewed = useCallback((identificator: string) => {
    setViewedRnpm((prev) => {
      if (prev.has(identificator)) return prev;
      const next = new Set(prev);
      next.add(identificator);
      try {
        sessionStorage.setItem("viewedRnpm", JSON.stringify([...next]));
      } catch {
        /* sessionStorage unavailable; visited-markers are best-effort */
      }
      return next;
    });
  }, []);

  const resultCriteriu = result?.criteriu;
  const resultDocumentCount = result?.documents.length ?? 0;
  const filter = useRnpmResultsFilter(result?.searchId ?? null, filterQuery);
  // Debounce tokens used for highlight + anyTokenMatches: altfel pe fiecare keystroke
  // se re-randeaza ~15 randuri × 3 celule + intregul detail expandat (zeci de campuri),
  // ceea ce blocheaza input-ul la valori scurte gen "2" sau "20".
  const [debouncedFilterForTokens] = useDebouncedValue(filterQuery, 300);
  const tokens = useMemo(() => tokenizeFilterQuery(debouncedFilterForTokens), [debouncedFilterForTokens]);
  const matchedSet = useMemo(() => {
    if (!filter.data) return null;
    return new Set(filter.data.matchedAvizIds);
  }, [filter.data]);

  useEffect(() => {
    void resultCriteriu;
    setPage(0);
  }, [resultCriteriu]);

  useEffect(() => {
    void resultCriteriu;
    if (resultDocumentCount > 0) {
      tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [resultCriteriu, resultDocumentCount]);

  useEffect(() => {
    if (filter.data) setPage(0);
  }, [filter.data]);

  const sortedPairs = useMemo(() => {
    if (!result) return [];
    let pairs = result.documents.map((doc, idx) => ({ doc, avizId: result.avizIds[idx] ?? null }));
    if (matchedSet) {
      pairs = pairs.filter((p) => p.avizId != null && matchedSet.has(p.avizId));
    }
    const startMs = dateStart ? new Date(`${dateStart}T00:00:00`).getTime() : null;
    const endMs = dateEnd ? new Date(`${dateEnd}T23:59:59`).getTime() : null;
    if (startMs != null || endMs != null) {
      pairs = pairs.filter((p) => {
        const t = parseRoDate(p.doc.data);
        if (!t) return false;
        if (startMs != null && t < startMs) return false;
        if (endMs != null && t > endMs) return false;
        return true;
      });
    }
    const dir = sortDir === "asc" ? 1 : -1;
    const cmp = (a: { doc: RnpmDocument }, b: { doc: RnpmDocument }): number => {
      switch (sortKey) {
        case "no":
          return (a.doc.no - b.doc.no) * dir;
        case "identificator":
          return a.doc.identificator.v.localeCompare(b.doc.identificator.v, "ro") * dir;
        case "data":
          return (parseRoDate(a.doc.data) - parseRoDate(b.doc.data)) * dir;
        case "tip":
          return (a.doc.tip ?? "").localeCompare(b.doc.tip ?? "", "ro") * dir;
        case "status": {
          const av = a.doc.activ === true ? 2 : a.doc.activ === false ? 1 : 0;
          const bv = b.doc.activ === true ? 2 : b.doc.activ === false ? 1 : 0;
          return (av - bv) * dir;
        }
        case "utilizator":
          return (a.doc.utilizatorAutorizat ?? "").localeCompare(b.doc.utilizatorAutorizat ?? "", "ro") * dir;
      }
    };
    return [...pairs].sort(cmp);
  }, [result, matchedSet, sortKey, sortDir, dateStart, dateEnd]);

  if (!result) return null;
  if (result.total === 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
        Nu au fost gasite rezultate pentru criteriile selectate.
      </div>
    );
  }

  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const togglePage = (docsOnPage: RnpmDocument[]) => {
    const pageIds = docsOnPage.map((d) => d.identificator.v);
    const allOnPageSelected = pageIds.every((id) => selected.has(id));
    const next = new Set(selected);
    for (const id of pageIds) {
      if (allOnPageSelected) next.delete(id);
      else next.add(id);
    }
    setSelected(next);
  };

  const getExportPairs = () => {
    if (selected.size === 0) return sortedPairs;
    return sortedPairs.filter((p) => selected.has(p.doc.identificator.v));
  };

  const loadedCount = sortedPairs.length;
  const totalPages = Math.max(1, Math.ceil(loadedCount / pageSize));
  const startIdx = page * pageSize;
  const endIdx = startIdx + pageSize;
  const paged = sortedPairs.slice(startIdx, endIdx);
  const hasMore = result.nextRnpmPage != null;
  const exportCountLabel =
    selected.size > 0 ? `(${selected.size})` : matchedSet ? `(${sortedPairs.length} filtrate)` : "";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-foreground">
          <span>
            {result.total.toLocaleString("ro-RO")} rezultate · incarcate {result.documents.length}
            {elapsedMs != null && <span> ({formatElapsed(elapsedMs)})</span>}
            {(dateStart || dateEnd || matchedSet) && sortedPairs.length !== result.documents.length && (
              <span className="ml-1 text-amber-600">· {sortedPairs.length} dupa filtre</span>
            )}
          </span>
          {selected.size > 0 && <span className="font-medium text-violet-600">({selected.size} selectate)</span>}
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <button
              type="button"
              className="text-xs text-muted-foreground underline hover:text-foreground"
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
              const pairs = getExportPairs();
              setExporting("xlsx");
              setExportError(null);
              try {
                await exportRnpmExcel(
                  pairs.map((p) => p.doc),
                  pairs.map((p) => p.avizId),
                  searchType
                );
              } catch (err) {
                console.error("[rnpm] export xlsx failed:", err);
                setExportError(`Export Excel esuat: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setExporting(null);
              }
            }}
          >
            {exporting === "xlsx" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}{" "}
            Excel {exportCountLabel}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={exporting !== null}
            onClick={async () => {
              const pairs = getExportPairs();
              setExporting("pdf");
              setExportError(null);
              try {
                await exportRnpmPDF(
                  pairs.map((p) => p.doc),
                  pairs.map((p) => p.avizId),
                  searchType
                );
              } catch (err) {
                console.error("[rnpm] export pdf failed:", err);
                setExportError(`Export PDF esuat: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setExporting(null);
              }
            }}
          >
            {exporting === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} PDF{" "}
            {exportCountLabel}
          </Button>
        </div>
      </div>
      {exportError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
          <div className="flex items-start justify-between gap-2">
            <p className="break-words">{exportError}</p>
            <button
              type="button"
              className="shrink-0 text-red-700/70 hover:text-red-700 dark:text-red-300/70 dark:hover:text-red-300"
              onClick={() => setExportError(null)}
            >
              Inchide
            </button>
          </div>
        </div>
      )}
      {result.criteriu && (
        <p className="truncate text-[11px] text-muted-foreground/70" title={result.criteriu}>
          {result.criteriu}
        </p>
      )}

      {result.searchId != null && (
        <div className="mb-3 space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Filtreaza rezultatele (debitor, creditor, descriere bun, identificator...)"
              aria-label="Filtru text peste rezultatele cautarii RNPM"
              className="w-full max-w-md rounded border border-gray-300 px-3 py-1 text-sm focus:border-blue-500 focus:outline-none disabled:bg-gray-100"
              disabled={filter.disabled}
              maxLength={200}
            />
            {filter.loading && <span className="text-xs text-gray-500">Filtrez...</span>}
            {filter.error && <span className="text-xs text-red-600">{filter.error}</span>}
            {filter.disabled && <span className="text-xs text-amber-600">Filtru indisponibil temporar.</span>}
          </div>
          {filter.data && (
            <div className="text-xs text-gray-600">
              {filter.data.matchedCount === filter.data.totalInSearch
                ? `${filter.data.totalInSearch} avize`
                : `${filter.data.matchedCount} din ${filter.data.totalInSearch} avize`}
              {filter.data.truncated && (
                <span className="ml-2 text-amber-600">
                  Afisez primele {filter.data.matchedAvizIds.length}. Restrange textul pentru rezultate complete.
                </span>
              )}
              {filter.data.missingDetails > 0 && (
                <span className="ml-2 text-amber-600">
                  {filter.data.missingDetails} avize fara detalii - unele rezultate pot fi ascunse.
                </span>
              )}
            </div>
          )}
        </div>
      )}

      <div ref={tableRef} className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs font-semibold uppercase tracking-wider text-foreground">
            <tr>
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border accent-blue-600 cursor-pointer"
                  checked={paged.length > 0 && paged.every((p) => selected.has(p.doc.identificator.v))}
                  onChange={() => togglePage(paged.map((p) => p.doc))}
                  title="Selecteaza pagina"
                />
              </th>
              <th className="px-4 py-3 text-center">
                <button
                  type="button"
                  className="inline-flex items-center justify-center gap-1 hover:text-foreground"
                  onClick={() => toggleSort("no")}
                >
                  Nr <SortIcon k="no" />
                </button>
              </th>
              <th className="px-4 py-3 text-center">
                <button
                  type="button"
                  className="inline-flex items-center justify-center gap-1 hover:text-foreground"
                  onClick={() => toggleSort("identificator")}
                >
                  Identificator <SortIcon k="identificator" />
                </button>
              </th>
              <th className="px-4 py-3 text-center">
                <button
                  type="button"
                  className="inline-flex items-center justify-center gap-1 hover:text-foreground"
                  onClick={() => toggleSort("data")}
                >
                  Data <SortIcon k="data" />
                </button>
              </th>
              <th className="px-4 py-3 text-center">
                <button
                  type="button"
                  className="inline-flex items-center justify-center gap-1 hover:text-foreground"
                  onClick={() => toggleSort("tip")}
                >
                  Tip <SortIcon k="tip" />
                </button>
              </th>
              <th className="px-4 py-3 text-center">
                <button
                  type="button"
                  className="inline-flex items-center justify-center gap-1 normal-case hover:text-foreground"
                  onClick={() => toggleSort("status")}
                >
                  Status <SortIcon k="status" />
                </button>
              </th>
              <th className="px-4 py-3 text-center">
                <button
                  type="button"
                  className="inline-flex items-center justify-center gap-1 hover:text-foreground"
                  onClick={() => toggleSort("utilizator")}
                >
                  Utilizator autorizat <SortIcon k="utilizator" />
                </button>
              </th>
              <th className="w-10 px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {paged.map(({ doc, avizId }) => {
              const isExpanded = expandedId === doc.identificator.v;
              const status = getRnpmAvizStatusDisplay(doc.activ);
              const collapsedMatches = anyTokenMatches([doc.identificator.v, doc.tip, doc.utilizatorAutorizat], tokens);
              const toggleExpand = () => {
                if (isExpanded) {
                  setExpandedId(null);
                  return;
                }
                if (avizId == null) {
                  onOpenDetail(doc, avizId);
                  return;
                }
                markAsViewed(doc.identificator.v);
                setExpandedId(doc.identificator.v);
              };
              return (
                <Fragment key={doc.identificator.v}>
                  <tr
                    onClick={toggleExpand}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggleExpand();
                      }
                    }}
                    tabIndex={0}
                    className={cn(
                      "border-t border-border cursor-pointer transition-colors",
                      isExpanded ? "bg-accent/40" : "hover:bg-accent/30"
                    )}
                  >
                    <td
                      className="px-4 py-3"
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-border accent-blue-600 cursor-pointer"
                        checked={selected.has(doc.identificator.v)}
                        onChange={() => toggleOne(doc.identificator.v)}
                      />
                    </td>
                    <td className="px-4 py-3 font-mono text-sm">{doc.no}</td>
                    <td className="px-4 py-3 font-mono text-sm whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        {!viewedRnpm.has(doc.identificator.v) ? (
                          <span className="relative flex h-2.5 w-2.5 shrink-0" title="Nevizualizat">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
                            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-blue-500" />
                          </span>
                        ) : (
                          <span title="Vizualizat">
                            <Eye className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                          </span>
                        )}
                        <span>{highlightTokens(doc.identificator.v, tokens)}</span>
                      </div>
                      {tokens.length > 0 && !collapsedMatches && (
                        <div className="mt-0.5 text-[10px] font-medium text-amber-600">match in detalii</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[13px] whitespace-nowrap">{doc.data}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Badge variant="outline" className="text-[12.5px] whitespace-nowrap">
                        {highlightTokens(doc.tip, tokens)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex flex-wrap items-center justify-center gap-1">
                        <Badge variant="outline" className={cn("text-[12.5px]", status.badgeClassName)}>
                          {status.label}
                        </Badge>
                        {doc.needsActualizare && (
                          <Badge variant="warning" className="text-[12.5px]">
                            actualizare
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[13px] text-foreground whitespace-nowrap">
                      {highlightTokens(doc.utilizatorAutorizat, tokens)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <ChevronRight
                        className={cn(
                          "h-4 w-4 text-muted-foreground transition-transform inline-block",
                          isExpanded && "rotate-90"
                        )}
                      />
                    </td>
                  </tr>
                  {isExpanded && avizId != null && (
                    <tr ref={expandedDetailRef} className="border-t border-border bg-muted/20">
                      <td colSpan={8} className="p-0">
                        <RnpmAvizDetailContent avizId={avizId} filterTokens={tokens} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {(totalPages > 1 || hasMore) && (
        <TablePagination
          page={page}
          totalPages={totalPages}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(0);
          }}
          hasMore={hasMore}
          loadMoreLoading={loading}
          onNeedMore={onNeedMore}
          loadedCount={loadedCount}
          totalResults={result.total}
        />
      )}
    </div>
  );
}

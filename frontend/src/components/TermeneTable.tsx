import { useState, useEffect, useRef, useCallback } from "react";
import { Download, CalendarDays, ExternalLink, ChevronDown, ChevronUp, Users, Scale, FileText, Building2, Eye } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Card } from "./ui/card";
import { formatDate, formatDocumentSedinta } from "@/lib/utils";
import type { Termen } from "@/types";
import { normalizeInstitutie } from "@/lib/institutii";

interface TermeneTableProps {
  termene: Termen[];
  onExportExcel: (selected?: Termen[]) => void;
  onExportPDF: (selected?: Termen[]) => void;
  searchedName?: string;
}

function HighlightName({ text, search }: { text: string; search?: string }) {
  if (!search || !text) return <>{text}</>;
  const searchWords = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (searchWords.length === 0) return <>{text}</>;
  const escaped = searchWords.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) => {
        const isMatch = searchWords.some((w) => part.toLowerCase() === w);
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

function getSolutieBadgeVariant(solutie: string): "default" | "secondary" | "outline" | "success" | "warning" {
  const s = (solutie ?? "").toLowerCase();
  if (s.includes("admite") || s.includes("hotărâre") || s.includes("hotarare")) return "success";
  if (s.includes("respinge") || s.includes("perim")) return "warning";
  if (s.includes("amân") || s.includes("aman")) return "secondary";
  return "outline";
}

function getPortalJustUrl(numar: string): string {
  return `https://portal.just.ro/SitePages/cautare.aspx?k=${encodeURIComponent(numar)}`;
}

function formatInstitutie(raw: string): string {
  if (!raw) return "-";
  return normalizeInstitutie(raw);
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

export function TermeneTable({ termene, onExportExcel, onExportPDF, searchedName }: TermeneTableProps) {
  const [page, setPage] = useState(0);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastExpandedKey, setLastExpandedKey] = useState<string | null>(null);
  const expandedDetailRef = useRef<HTMLTableRowElement>(null);

  // Track viewed (expanded) termene — persist in sessionStorage
  const [viewedTermene, setViewedTermene] = useState<Set<string>>(() => {
    try {
      const saved = sessionStorage.getItem("viewedTermene");
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });

  const markAsViewed = useCallback((numarDosar: string) => {
    setViewedTermene((prev) => {
      if (prev.has(numarDosar)) return prev;
      const next = new Set(prev);
      next.add(numarDosar);
      try { sessionStorage.setItem("viewedTermene", JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);

  const toggleRow = (key: string, numarDosar?: string) => {
    setExpandedRows((prev) => {
      if (prev.has(key)) {
        setLastExpandedKey(null);
        return new Set();
      } else {
        setLastExpandedKey(key);
        if (numarDosar) markAsViewed(numarDosar);
        return new Set([key]);
      }
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
        if (
          (style.overflowY === "auto" || style.overflowY === "scroll") &&
          parent.scrollHeight > parent.clientHeight
        ) {
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

  const toggleSelectAll = () => {
    const pageKeys = paged.map((_, i) => `${page * pageSize + i}`);
    const allSelected = pageKeys.every((k) => selected.has(k));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        pageKeys.forEach((k) => next.delete(k));
      } else {
        pageKeys.forEach((k) => next.add(k));
      }
      return next;
    });
  };

  const getExportTermene = (): Termen[] | undefined => {
    if (selected.size === 0) return undefined;
    return Array.from(selected)
      .map((k) => termene[parseInt(k, 10)])
      .filter(Boolean);
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const isViitor = (dateStr: string) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    return !isNaN(d.getTime()) && d >= today;
  };

  const paged = termene.slice(page * pageSize, (page + 1) * pageSize);
  const totalPages = Math.ceil(termene.length / pageSize);

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">{termene.length} termene gasite</span>
          {selected.size > 0 && (
            <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => setSelected(new Set())}>
              Deselecteaza tot
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => onExportExcel(getExportTermene())}>
            <Download className="h-4 w-4" /> Excel {selected.size > 0 ? `(${selected.size})` : ""}
          </Button>
          <Button variant="outline" size="sm" onClick={() => onExportPDF(getExportTermene())}>
            <Download className="h-4 w-4" /> PDF {selected.size > 0 ? `(${selected.size})` : ""}
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
                  className="h-4 w-4 rounded border-gray-300 accent-violet-600"
                  checked={paged.length > 0 && paged.every((_, i) => selected.has(`${page * pageSize + i}`))}
                  onChange={toggleSelectAll}
                />
              </th>
              {["Numar Dosar", "Data", "Ora", "Institutie", "Complet", "Solutie"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {paged.map((t, i) => {
              const rowKey = `${t.numarDosar}-${t.data}-${i}`;
              const selectKey = `${page * pageSize + i}`;
              const isExpanded = expandedRows.has(rowKey);
              const isSelected = selected.has(selectKey);
              const hasParts = t.parti && t.parti.length > 0;
              const hasDetails = hasParts || t.categorieCaz || t.stadiuProcesual || t.obiect || t.solutie || t.solutieSumar;

              return (
                <>
                  <tr
                    key={rowKey}
                    onClick={() => hasDetails && toggleRow(rowKey, t.numarDosar)}
                    className={`transition-colors hover:bg-muted/30 ${isViitor(t.data) ? "bg-primary/5" : ""} ${hasDetails ? "cursor-pointer" : ""} ${isSelected ? "bg-violet-50 dark:bg-violet-900/10" : ""}`}
                  >
                    <td className="w-10 px-2 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-gray-300 accent-violet-600"
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
                          <span title="Vizualizat"><Eye className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" /></span>
                        ) : null}
                        {t.numarDosar ? (
                          <a
                            href={getPortalJustUrl(t.numarDosar)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1.5 text-primary hover:text-primary/80 hover:underline"
                          >
                            {t.numarDosar}
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                        ) : "-"}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[13px] ${isExpanded ? "font-bold text-red-800 dark:text-red-400" : "text-foreground"}`}>{formatDate(t.data)}</span>
                        {isViitor(t.data) && <Badge variant="success" className="text-[11px]">Viitor</Badge>}
                      </div>
                    </td>
                    <td className={`px-4 py-3 text-[13px] ${isExpanded ? "font-bold text-red-800 dark:text-red-400" : "text-muted-foreground"}`}>{t.ora || "-"}</td>
                    <td className={`px-4 py-3 text-[13px] max-w-[220px] truncate ${isExpanded ? "font-bold text-red-800 dark:text-red-400" : ""}`} title={normalizeInstitutie(t.institutie)}>{formatInstitutie(t.institutie)}</td>
                    <td className="px-4 py-3 text-[13px]">{t.complet || "-"}</td>
                    <td className="px-4 py-3 text-[13px] max-w-[250px]">
                      {t.solutie ? (
                        <div>
                          <p className="font-medium">{formatDocumentSedinta(t.solutie!)}</p>
                          {t.solutieSumar && (
                            <p className="text-muted-foreground truncate" title={t.solutieSumar}>{t.solutieSumar}</p>
                          )}
                        </div>
                      ) : <span className="text-muted-foreground">-</span>}
                    </td>
                  </tr>
                  {isExpanded && hasDetails && (
                    <tr key={`${rowKey}-detail`} ref={lastExpandedKey === rowKey ? expandedDetailRef : undefined} className="bg-muted/20">
                      <td colSpan={7} className="px-4 py-4">
                        <div className="space-y-3 pl-6">
                          {/* Info badges */}
                          <div className="flex flex-wrap gap-3">
                            {t.categorieCaz && (
                              <div className="flex items-center gap-1.5 text-xs">
                                <Scale className="h-3.5 w-3.5 text-muted-foreground" />
                                <span className="text-muted-foreground">Categorie:</span>
                                <Badge variant="outline" className="text-[11px]">{t.categorieCaz}</Badge>
                              </div>
                            )}
                            {t.stadiuProcesual && (
                              <div className="flex items-center gap-1.5 text-xs">
                                <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                                <span className="text-muted-foreground">Stadiu:</span>
                                <Badge variant="outline" className="text-[11px]">{t.stadiuProcesual}</Badge>
                              </div>
                            )}
                            {t.obiect && (
                              <div className="flex items-center gap-1.5 text-xs">
                                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                                <span className="text-muted-foreground">Obiect:</span>
                                <span className="text-xs font-medium">{t.obiect}</span>
                              </div>
                            )}
                          </div>

                          {/* Solutie completa */}
                          {(t.solutie || t.solutieSumar) && (
                            <div>
                              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                <Scale className="h-3.5 w-3.5" /> Solutie
                              </h4>
                              <div className="rounded-lg border border-border bg-background p-3">
                                {t.solutie && (
                                  <p className="mb-2 text-sm font-medium text-foreground">{formatDocumentSedinta(t.solutie!)}</p>
                                )}
                                {t.solutieSumar && (
                                  <div className="rounded bg-muted/30 p-2">
                                    <p className="leading-relaxed text-foreground" style={{ fontSize: "14.5px" }}>{t.solutieSumar}</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Parti */}
                          {hasParts && (
                            <div>
                              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                <Users className="h-3.5 w-3.5" /> Parti ({t.parti!.length})
                              </h4>
                              <div className="grid gap-1 rounded-lg border border-border bg-background p-3 sm:grid-cols-2">
                                {t.parti!.map((p, j) => (
                                  <div key={j} className="flex items-center gap-1.5 text-xs">
                                    <Badge variant="outline" className="shrink-0 text-xs">
                                      {p.calitateParte}
                                    </Badge>
                                    <span className="truncate" title={p.nume}>
                                      <HighlightName text={p.nume} search={searchedName} />
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
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
              {[10, 20, 50, 100].map((size) => (
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

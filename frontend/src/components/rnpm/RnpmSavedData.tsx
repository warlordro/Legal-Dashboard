import { useEffect, useMemo, useState, useCallback } from "react";
import { Search, Trash2, Eye, Loader2, Download, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { getRnpmAvizStatusDisplay } from "@/lib/rnpmAvizStatus";
import { rnpmGetSaved, rnpmGetAllSaved, rnpmDeleteAviz, rnpmDeleteAvizeBatch } from "@/lib/rnpmApi";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { exportRnpmExcel, exportRnpmPDF } from "@/lib/rnpmExport";
import { TablePagination } from "@/components/table-pagination";
import type { RnpmAvizRecord, RnpmSearchType, RnpmDocument, RnpmSavedSortKey, RnpmSavedSortDir } from "@/types/rnpm";

function toDocs(records: RnpmAvizRecord[]): { docs: RnpmDocument[]; avizIds: (number | null)[] } {
  const docs: RnpmDocument[] = records.map((a, i) => ({
    no: i + 1,
    identificator: { v: a.identificator, k: null },
    utilizatorAutorizat: a.utilizator_autorizat ?? "",
    data: a.data,
    tip: a.tip,
    needsActualizare: a.needs_actualizare === 1,
    activ: a.activ === 1 ? true : a.activ === 0 ? false : null,
  }));
  const avizIds = records.map((a) => a.id);
  return { docs, avizIds };
}

const TYPES: { value: "" | RnpmSearchType; label: string }[] = [
  { value: "", label: "Toate categoriile" },
  { value: "ipoteci", label: "Aviz de ipoteca mobiliara" },
  { value: "fiducii", label: "Fiducie" },
  { value: "specifice", label: "Aviz specific" },
  { value: "creante", label: "Aviz de ipoteca - creante securitizate" },
  { value: "obligatiuni", label: "Aviz de ipoteca - obligatiuni ipotecare" },
];

export interface RnpmSavedDataProps {
  onOpenDetail: (id: number) => void;
  refreshKey?: number;
  onChanged?: () => void;
}

export function RnpmSavedData({ onOpenDetail, refreshKey, onChanged }: RnpmSavedDataProps) {
  const confirm = useConfirm();
  const [items, setItems] = useState<RnpmAvizRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | null>(null);
  const [q, setQ] = useState("");
  const [searchType, setSearchType] = useState<"" | RnpmSearchType>("");
  const [activOnly, setActivOnly] = useState(false);
  const [dataStart, setDataStart] = useState("");
  const [dataStop, setDataStop] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [sortKey, setSortKey] = useState<RnpmSavedSortKey>("data");
  const [sortDir, setSortDir] = useState<RnpmSavedSortDir>("desc");

  const toggleSort = (key: RnpmSavedSortKey) => {
    setPage(0);
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const SortIcon = ({ k }: { k: RnpmSavedSortKey }) => {
    if (sortKey !== k) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
    return sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await rnpmGetSaved({
        page,
        pageSize,
        searchType: searchType || undefined,
        activ: activOnly ? true : undefined,
        q: q.trim() || undefined,
        dataStart: dataStart || undefined,
        dataStop: dataStop || undefined,
        sortKey,
        sortDir,
      });
      setItems(result.items);
      setTotal(result.total);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, q, searchType, activOnly, dataStart, dataStop, sortKey, sortDir]);

  useEffect(() => {
    void refreshKey;
    load();
  }, [load, refreshKey]);

  // Reset selection when filters/sort/page change, since the visible set changes too.
  useEffect(() => {
    void searchType;
    void activOnly;
    void dataStart;
    void dataStop;
    void sortKey;
    void sortDir;
    void page;
    void pageSize;
    void refreshKey;
    setSelectedIds(new Set());
  }, [searchType, activOnly, dataStart, dataStop, sortKey, sortDir, page, pageSize, refreshKey]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSelectedIds(new Set());
    setPage(0);
    load();
  };

  // Dupa stergere: refetch pagina curenta (nu doar filtrez local) ca sa urce randurile
  // din paginile urmatoare. Daca pagina curenta ar deveni goala (toate randurile erau
  // pe ultima pagina), saltam la ultima pagina valida — altfel userul ramane pe o pagina
  // goala cu "Inainte" dezactivat.
  const refreshAfterDelete = async (removedCount: number) => {
    const newTotal = Math.max(0, total - removedCount);
    const lastPage = newTotal === 0 ? 0 : Math.ceil(newTotal / pageSize) - 1;
    if (page > lastPage) {
      setPage(lastPage); // declanseaza load via useEffect
    } else {
      await load();
    }
  };

  const handleDelete = async (id: number) => {
    if (
      !(await confirm({
        message: "Sterge acest aviz din baza locala?",
        confirmLabel: "Sterge",
        destructive: true,
      }))
    )
      return;
    await rnpmDeleteAviz(id);
    setSelectedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    await refreshAfterDelete(1);
    onChanged?.();
  };

  const handleDeleteSelected = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (
      !(await confirm({
        message: `Stergi ${ids.length} aviz${ids.length === 1 ? "" : "e"} selectat${ids.length === 1 ? "" : "e"}?\n\nActiunea nu poate fi anulata.`,
        confirmLabel: "Sterge",
        destructive: true,
      }))
    )
      return;
    setLoading(true);
    try {
      await rnpmDeleteAvizeBatch(ids);
      setSelectedIds(new Set());
      await refreshAfterDelete(ids.length);
      onChanged?.();
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async (format: "xlsx" | "pdf") => {
    setExporting(format);
    setLoading(true);
    try {
      let target: RnpmAvizRecord[];
      if (selectedIds.size > 0) {
        target = items.filter((a) => selectedIds.has(a.id));
      } else {
        target = await rnpmGetAllSaved({
          searchType: searchType || undefined,
          activ: activOnly ? true : undefined,
          q: q.trim() || undefined,
          dataStart: dataStart || undefined,
          dataStop: dataStop || undefined,
          sortKey,
          sortDir,
        });
      }
      if (target.length === 0) return;
      const { docs, avizIds } = toDocs(target);
      const types = new Set(target.map((a) => a.search_type));
      const suffix = types.size === 1 ? searchType || [...types][0] : "local";
      if (format === "xlsx") await exportRnpmExcel(docs, avizIds, suffix);
      else await exportRnpmPDF(docs, avizIds, suffix);
    } catch (err) {
      console.error(`[rnpm] export ${format} failed:`, err);
    } finally {
      setLoading(false);
      setExporting(null);
    }
  };

  const toggleRow = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const visibleIds = useMemo(() => items.map((i) => i.id), [items]);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someVisibleSelected = !allVisibleSelected && visibleIds.some((id) => selectedIds.has(id));

  const toggleAllVisible = () => {
    setSelectedIds((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        for (const id of visibleIds) next.delete(id);
        return next;
      }
      const next = new Set(prev);
      for (const id of visibleIds) next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      <form onSubmit={handleSearch} className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cauta (numar aviz / identificator, numar contract, CUI, CNP, denumire...)"
            className="pl-8"
          />
        </div>
        <div className="w-[200px]">
          <Select value={searchType} onValueChange={(v) => setSearchType(v as "" | RnpmSearchType)}>
            <SelectTrigger>
              <SelectValue placeholder="Tip" />
            </SelectTrigger>
            <SelectContent>
              {TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>De la</span>
          <Input
            type="date"
            value={dataStart}
            onChange={(e) => setDataStart(e.target.value)}
            onClick={(e) => e.currentTarget.showPicker?.()}
            className="h-9 w-[160px] cursor-pointer"
          />
          <span>pana la</span>
          <Input
            type="date"
            value={dataStop}
            onChange={(e) => setDataStop(e.target.value)}
            onClick={(e) => e.currentTarget.showPicker?.()}
            className="h-9 w-[160px] cursor-pointer"
          />
          {(dataStart || dataStop) && (
            <button
              type="button"
              onClick={() => {
                setDataStart("");
                setDataStop("");
              }}
              className="ml-1 text-xs text-muted-foreground underline hover:text-foreground"
            >
              reset
            </button>
          )}
        </div>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border accent-blue-600"
            checked={activOnly}
            onChange={(e) => setActivOnly(e.target.checked)}
          />
          Doar active
        </label>
        <Button type="submit" size="sm" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Filtreaza
        </Button>
      </form>

      {items.length === 0 && !loading && (
        <div className="rounded-lg border border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          Baza locala este goala. Fa o cautare pentru a popula datele.
        </div>
      )}

      {items.length > 0 && (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-foreground">
            <span>
              {total} aviz{total === 1 ? "" : "e"}
            </span>
            {selectedIds.size > 0 && (
              <span className="font-medium text-violet-600">({selectedIds.size} selectate pe aceasta pagina)</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {selectedIds.size > 0 && (
              <>
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline hover:text-foreground"
                  onClick={() => setSelectedIds(new Set())}
                >
                  Deselecteaza tot
                </button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleDeleteSelected}
                  disabled={loading}
                  className="text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400"
                >
                  <Trash2 className="h-4 w-4" /> Sterge ({selectedIds.size})
                </Button>
              </>
            )}
            <Button type="button" variant="outline" size="sm" onClick={() => handleExport("xlsx")} disabled={loading}>
              {exporting === "xlsx" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}{" "}
              Excel ({selectedIds.size > 0 ? selectedIds.size : total})
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => handleExport("pdf")} disabled={loading}>
              {exporting === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}{" "}
              PDF ({selectedIds.size > 0 ? selectedIds.size : total})
            </Button>
          </div>
        </div>
      )}

      {items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs font-semibold uppercase tracking-wider text-foreground">
              <tr>
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someVisibleSelected;
                    }}
                    onChange={toggleAllVisible}
                    title={allVisibleSelected ? "Deselecteaza vizibile" : "Selecteaza vizibile"}
                    className="h-4 w-4 rounded border-border accent-blue-600 cursor-pointer"
                  />
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
                    onClick={() => toggleSort("search_type")}
                  >
                    Categorie <SortIcon k="search_type" />
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
                    onClick={() => toggleSort("activ")}
                  >
                    Stare <SortIcon k="activ" />
                  </button>
                </th>
                <th className="w-20 px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {items.map((a) => {
                const status = getRnpmAvizStatusDisplay(a.activ === 1 ? true : a.activ === 0 ? false : null);
                return (
                  <tr
                    key={a.id}
                    className={cn(
                      "border-t border-border cursor-pointer transition-colors",
                      selectedIds.has(a.id) ? "bg-accent/20" : "hover:bg-accent/30"
                    )}
                    onClick={() => onOpenDetail(a.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onOpenDetail(a.id);
                      }
                    }}
                    tabIndex={0}
                  >
                    <td className="px-4 py-3" onMouseDown={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(a.id)}
                        onChange={() => toggleRow(a.id)}
                        className="h-4 w-4 rounded border-border accent-blue-600 cursor-pointer"
                      />
                    </td>
                    <td className="px-4 py-3 font-mono text-sm whitespace-nowrap">{a.identificator}</td>
                    <td className="px-4 py-3 text-center">
                      <Badge variant="outline" className="text-[12.5px]">
                        {a.search_type}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-[13px] whitespace-nowrap text-center">{a.data}</td>
                    <td className="px-4 py-3 text-[13px]">{a.tip}</td>
                    <td className="px-4 py-3 text-center">
                      <Badge variant="outline" className={cn("text-[12.5px]", status.badgeClassName)}>
                        {status.label}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-center" onMouseDown={(e) => e.stopPropagation()}>
                      <div className="flex justify-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onOpenDetail(a.id)}
                          className="h-7 w-7 p-0"
                          title="Deschide"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(a.id)}
                          className="h-7 w-7 p-0 hover:text-red-500"
                          title="Sterge"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {total > 0 && totalPages > 1 && (
        <TablePagination
          page={page}
          totalPages={totalPages}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(0);
          }}
          disabled={loading}
        />
      )}
    </div>
  );
}

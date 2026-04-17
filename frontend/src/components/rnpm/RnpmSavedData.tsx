import { useEffect, useMemo, useState, useCallback } from "react";
import { Search, Trash2, Eye, Loader2, Download, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { rnpmGetSaved, rnpmDeleteAviz, rnpmDeleteAvizeBatch } from "@/lib/rnpmApi";
import { exportRnpmExcel, exportRnpmPDF } from "@/lib/rnpmExport";
import type { RnpmAvizRecord, RnpmSearchType, RnpmDocument } from "@/types/rnpm";

type SortKey = "identificator" | "search_type" | "data" | "tip" | "activ";
type SortDir = "asc" | "desc";

function parseRoDate(s: string): number {
  if (!s) return 0;
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (m) {
    const d = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    let y = parseInt(m[3], 10);
    if (y < 100) y += 2000;
    return new Date(y, mo - 1, d).getTime();
  }
  const t = Date.parse(s);
  return isNaN(t) ? 0 : t;
}

function toDocs(records: RnpmAvizRecord[]): { docs: RnpmDocument[]; avizIds: (number | null)[] } {
  const docs: RnpmDocument[] = records.map((a, i) => ({
    no: i + 1,
    identificator: { v: a.identificator, k: null },
    utilizatorAutorizat: a.utilizator_autorizat ?? "",
    data: a.data,
    tip: a.tip,
    needsActualizare: a.needs_actualizare === 1,
    activ: a.activ === 1,
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
  const [items, setItems] = useState<RnpmAvizRecord[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [searchType, setSearchType] = useState<"" | RnpmSearchType>("");
  const [activOnly, setActivOnly] = useState(false);
  const [dataStart, setDataStart] = useState("");
  const [dataStop, setDataStop] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("data");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
    return sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  };

  const load = useCallback(async (reset: boolean) => {
    setLoading(true);
    try {
      const page = await rnpmGetSaved({
        limit: 50,
        cursor: reset ? null : nextCursor,
        searchType: searchType || undefined,
        activ: activOnly ? true : undefined,
        q: q.trim() || undefined,
        dataStart: dataStart || undefined,
        dataStop: dataStop || undefined,
      });
      setItems((prev) => reset ? page.items : [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } finally {
      setLoading(false);
    }
  }, [nextCursor, q, searchType, activOnly, dataStart, dataStop]);

  useEffect(() => {
    // Reset selection when filters change or parent forces refresh.
    setSelectedIds(new Set());
    load(true);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [searchType, activOnly, dataStart, dataStop, refreshKey]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSelectedIds(new Set());
    load(true);
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Sterge acest aviz din baza locala?")) return;
    await rnpmDeleteAviz(id);
    setItems((prev) => prev.filter((i) => i.id !== id));
    setSelectedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev); next.delete(id); return next;
    });
    onChanged?.();
  };

  const handleDeleteSelected = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!confirm(`Stergi ${ids.length} aviz${ids.length === 1 ? "" : "e"} selectat${ids.length === 1 ? "" : "e"}?\n\nActiunea nu poate fi anulata.`)) return;
    setLoading(true);
    try {
      await rnpmDeleteAvizeBatch(ids);
      const removed = new Set(ids);
      setItems((prev) => prev.filter((i) => !removed.has(i.id)));
      setSelectedIds(new Set());
      onChanged?.();
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async (format: "xlsx" | "pdf") => {
    const target = selectedIds.size > 0
      ? items.filter((a) => selectedIds.has(a.id))
      : items;
    if (target.length === 0) return;
    const { docs, avizIds } = toDocs(target);
    const types = new Set(target.map((a) => a.search_type));
    const suffix = types.size === 1 ? (searchType || [...types][0]) : "local";
    setLoading(true);
    try {
      if (format === "xlsx") await exportRnpmExcel(docs, avizIds, suffix);
      else await exportRnpmPDF(docs, avizIds, suffix);
    } finally {
      setLoading(false);
    }
  };

  const toggleRow = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const sortedItems = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const cmp = (a: RnpmAvizRecord, b: RnpmAvizRecord): number => {
      switch (sortKey) {
        case "identificator": return a.identificator.localeCompare(b.identificator, "ro") * dir;
        case "search_type": return a.search_type.localeCompare(b.search_type, "ro") * dir;
        case "data": return (parseRoDate(a.data) - parseRoDate(b.data)) * dir;
        case "tip": return (a.tip ?? "").localeCompare(b.tip ?? "", "ro") * dir;
        case "activ": return (a.activ - b.activ) * dir;
      }
    };
    return [...items].sort(cmp);
  }, [items, sortKey, sortDir]);

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
        <select value={searchType} onChange={(e) => setSearchType(e.target.value as "" | RnpmSearchType)}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm">
          {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
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
            <button type="button" onClick={() => { setDataStart(""); setDataStop(""); }}
              className="ml-1 text-xs text-muted-foreground underline hover:text-foreground">
              reset
            </button>
          )}
        </div>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={activOnly} onChange={(e) => setActivOnly(e.target.checked)} />
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
              {items.length} aviz{items.length === 1 ? "" : "e"}
            </span>
            {selectedIds.size > 0 && (
              <span className="font-medium text-violet-600">({selectedIds.size} selectate)</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {selectedIds.size > 0 && (
              <>
                <button className="text-xs text-muted-foreground underline hover:text-foreground" onClick={() => setSelectedIds(new Set())}>
                  Deselecteaza tot
                </button>
                <Button type="button" variant="outline" size="sm" onClick={handleDeleteSelected} disabled={loading}
                  className="text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400">
                  <Trash2 className="h-4 w-4" /> Sterge ({selectedIds.size})
                </Button>
              </>
            )}
            <Button type="button" variant="outline" size="sm" onClick={() => handleExport("xlsx")} disabled={loading}>
              <Download className="h-4 w-4" /> Excel {selectedIds.size > 0 ? `(${selectedIds.size})` : ""}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => handleExport("pdf")} disabled={loading}>
              <Download className="h-4 w-4" /> PDF {selectedIds.size > 0 ? `(${selectedIds.size})` : ""}
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
                    ref={(el) => { if (el) el.indeterminate = someVisibleSelected; }}
                    onChange={toggleAllVisible}
                    title={allVisibleSelected ? "Deselecteaza vizibile" : "Selecteaza vizibile"}
                    className="cursor-pointer"
                  />
                </th>
                <th className="px-4 py-3 text-center">
                  <button className="inline-flex items-center justify-center gap-1 hover:text-foreground" onClick={() => toggleSort("identificator")}>
                    Identificator <SortIcon k="identificator" />
                  </button>
                </th>
                <th className="px-4 py-3 text-center">
                  <button className="inline-flex items-center justify-center gap-1 hover:text-foreground" onClick={() => toggleSort("search_type")}>
                    Categorie <SortIcon k="search_type" />
                  </button>
                </th>
                <th className="px-4 py-3 text-center">
                  <button className="inline-flex items-center justify-center gap-1 hover:text-foreground" onClick={() => toggleSort("data")}>
                    Data <SortIcon k="data" />
                  </button>
                </th>
                <th className="px-4 py-3 text-center">
                  <button className="inline-flex items-center justify-center gap-1 hover:text-foreground" onClick={() => toggleSort("tip")}>
                    Tip <SortIcon k="tip" />
                  </button>
                </th>
                <th className="px-4 py-3 text-center">
                  <button className="inline-flex items-center justify-center gap-1 normal-case hover:text-foreground" onClick={() => toggleSort("activ")}>
                    Stare <SortIcon k="activ" />
                  </button>
                </th>
                <th className="w-20 px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((a) => (
                <tr key={a.id} className={cn(
                  "border-t border-border cursor-pointer transition-colors",
                  selectedIds.has(a.id) ? "bg-accent/20" : "hover:bg-accent/30"
                )}
                onClick={() => onOpenDetail(a.id)}>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(a.id)}
                      onChange={() => toggleRow(a.id)}
                      className="cursor-pointer"
                    />
                  </td>
                  <td className="px-4 py-3 font-mono text-sm whitespace-nowrap">{a.identificator}</td>
                  <td className="px-4 py-3 text-center">
                    <Badge variant="outline" className="text-[12.5px]">{a.search_type}</Badge>
                  </td>
                  <td className="px-4 py-3 text-[13px] whitespace-nowrap text-center">{a.data}</td>
                  <td className="px-4 py-3 text-[13px]">{a.tip}</td>
                  <td className="px-4 py-3 text-center">
                    <Badge variant={a.activ ? "success" : "destructive"} className="text-[12.5px]">
                      {a.activ ? "activ" : "inactiv"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => onOpenDetail(a.id)} className="h-7 w-7 p-0" title="Deschide">
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(a.id)} className="h-7 w-7 p-0 hover:text-red-500" title="Sterge">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {nextCursor != null && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => load(false)} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Incarca mai multe
          </Button>
        </div>
      )}
    </div>
  );
}

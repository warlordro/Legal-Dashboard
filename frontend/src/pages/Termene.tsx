import { lazy, Suspense, useState, useEffect, useRef } from "react";
import { CalendarDays, AlertTriangle } from "lucide-react";
import { SearchForm } from "@/components/SearchForm";
import { TermeneTable } from "@/components/TermeneTable";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import type { LoadMoreProgress } from "@/lib/api";
import { exportTermeneExcel, exportTermenePDF } from "@/lib/export";
import type { Termen, SearchParams } from "@/types";
import { CalendarView } from "@/components/CalendarView";
// Lazy: TermeneMetrics pulls in recharts (heavy). Only mounts when results exist.
const TermeneMetrics = lazy(() => import("@/components/TermeneMetrics").then((m) => ({ default: m.TermeneMetrics })));
import type { MetricFilter } from "@/components/TermeneMetrics";
import { Button } from "@/components/ui/button";

type ViewMode = "table" | "calendar";

const KNOWN_CATS = ["Penal", "Civil", "Contencios", "Litigii de munc", "Faliment", "Litigii cu profesioni"];

function filterTermeneByCategorii(termene: Termen[], categorii: string[]): Termen[] {
  if (categorii.length === 0) return termene;
  const hasAltele = categorii.includes("Altele");
  const realCats = categorii.filter((c) => c !== "Altele");
  return termene.filter((t) => {
    const cat = (t.categorieCaz ?? "").toLowerCase();
    const matchesReal = realCats.some((c) => cat.includes(c.toLowerCase()));
    const matchesAltele = hasAltele && !KNOWN_CATS.some((k) => cat.includes(k.toLowerCase()));
    return matchesReal || matchesAltele;
  });
}

function filterTermeneByStadii(termene: Termen[], stadii: string[]): Termen[] {
  if (stadii.length === 0) return termene;
  return termene.filter((t) => {
    const stadiu = (t.stadiuProcesual ?? "").toLowerCase();
    return stadii.some((s) => stadiu.includes(s.toLowerCase()));
  });
}

interface TermeneState {
  allTermene: Termen[];
  categorii: string[];
  stadii: string[];
  searched: boolean;
  error: string | null;
  searchedName?: string;
  lastSearchParams?: SearchParams;
}

interface TermeneProps {
  state: TermeneState;
  onStateChange: React.Dispatch<React.SetStateAction<TermeneState>>;
  onSearchComplete?: (params: SearchParams, resultCount: number) => void;
  pendingSearch?: SearchParams | null;
  consumePendingSearch?: () => void;
}

function filterByDate(termene: Termen[], dataStart?: string, dataStop?: string): Termen[] {
  if (!dataStart && !dataStop) return termene;
  return termene.filter((t) => {
    if (!t.data) return true;
    if (dataStart && t.data < dataStart) return false;
    if (dataStop && t.data > dataStop) return false;
    return true;
  });
}

function filterByMetrics(termene: Termen[], filters: MetricFilter[]): Termen[] {
  if (filters.length === 0) return termene;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return termene.filter((t) => {
    const d = t.data ? new Date(t.data) : null;
    const isViitor = d && !isNaN(d.getTime()) && d >= now;
    const isTrecut = !isViitor;
    const hasSolutie = !!(t.solutie && t.solutie.trim());

    // OR logic: match any active filter
    if (filters.includes("viitoare") && isViitor) return true;
    if (filters.includes("trecute") && isTrecut) return true;
    if (filters.includes("cuSolutie") && hasSolutie) return true;
    return false;
  });
}

export default function Termene({ state, onStateChange, onSearchComplete, pendingSearch, consumePendingSearch }: TermeneProps) {
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreProgress, setLoadMoreProgress] = useState<LoadMoreProgress | null>(null);
  const [loadMoreWarnings, setLoadMoreWarnings] = useState<string[]>([]);
  const [loadMoreDone, setLoadMoreDone] = useState(false);
  const [initialDosareCount, setInitialDosareCount] = useState(0);
  const lastSearchParams = useRef<SearchParams | null>(state.lastSearchParams ?? null);
  const loadMoreAbort = useRef<AbortController | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [metricFilters, setMetricFilters] = useState<MetricFilter[]>([]);
  const [dateFilter, setDateFilter] = useState<{ start?: string; stop?: string }>({});

  const filteredByDate = filterByDate(state.allTermene, dateFilter.start, dateFilter.stop);
  const filteredByCatStadiu = filterTermeneByStadii(
    filterTermeneByCategorii(filteredByDate, state.categorii),
    state.stadii ?? []
  );
  const termene = filterByMetrics(filteredByCatStadiu, metricFilters);

  const toggleMetricFilter = (filter: MetricFilter) => {
    setMetricFilters((prev) =>
      prev.includes(filter) ? prev.filter((f) => f !== filter) : [...prev, filter]
    );
  };

  const handleSearch = async (params: SearchParams) => {
    setLoading(true);
    setMetricFilters([]);
    setDateFilter({});
    setLoadMoreDone(false);
    setLoadMoreWarnings([]);
    setLoadMoreProgress(null);
    setInitialDosareCount(0);
    onStateChange({ ...state, error: null, searched: true });
    try {
      const { categorii: cats, stadii: st, ...searchParams } = params;
      lastSearchParams.current = searchParams;
      const res = await api.termene.search(searchParams);
      // The termene endpoint returns termene extracted from dosare.
      // We detect the 1000-dosare cap by checking if we got a large number of termene
      // from the response. The backend returns total termene count.
      // Since 1000 dosare can produce many more termene, we track via a special header or heuristic.
      // For simplicity: if the response includes a `dosareCount` we use that, otherwise we estimate.
      const dosareCount = (res as any).dosareCount ?? 0;
      setInitialDosareCount(dosareCount);
      onStateChange({
        allTermene: res.data,
        categorii: cats ?? [],
        stadii: st ?? [],
        searched: true,
        error: null,
        searchedName: searchParams.numeParte,
        lastSearchParams: params,
      });
      onSearchComplete?.(params, res.data.length);
    } catch (e) {
      onStateChange({
        allTermene: [],
        categorii: state.categorii,
        stadii: state.stadii,
        searched: true,
        error: e instanceof Error ? e.message : "Eroare la cautare",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleLoadMore = async () => {
    if (!lastSearchParams.current) return;
    const abort = new AbortController();
    loadMoreAbort.current = abort;
    setLoadingMore(true);
    setLoadMoreProgress(null);
    setLoadMoreWarnings([]);

    // Extract unique dosare numbers from existing termene — backend will skip these dosare
    const existingDosareNr = [...new Set(state.allTermene.map((t) => t.numarDosar))];
    // Track new termene incrementally
    const allTermene = [...state.allTermene];
    const knownKeys = new Set(
      state.allTermene.map((t) => `${t.numarDosar}|${t.data}|${t.ora}|${t.complet}`),
    );
    let newCount = 0;

    try {
      const result = await api.termene.loadMore(
        lastSearchParams.current,
        (progress) => setLoadMoreProgress({
          ...progress,
          found: newCount,
        }),
        abort.signal,
        (batch) => {
          for (const t of batch) {
            const key = `${t.numarDosar}|${t.data}|${t.ora}|${t.complet}`;
            if (!knownKeys.has(key)) {
              knownKeys.add(key);
              allTermene.push(t);
              newCount++;
            }
          }
          // Functional update: don't capture stale `state`. Filter changes mid-stream stay intact.
          onStateChange((prev) => ({
            ...prev,
            allTermene: [...allTermene],
          }));
        },
        existingDosareNr,
      );
      // Final pass
      for (const t of result.data) {
        const key = `${t.numarDosar}|${t.data}|${t.ora}|${t.complet}`;
        if (!knownKeys.has(key)) {
          knownKeys.add(key);
          allTermene.push(t);
          newCount++;
        }
      }
      onStateChange((prev) => ({
        ...prev,
        allTermene: [...allTermene],
      }));
      const warnings = result.warnings || [];
      if (result.partial) warnings.unshift("Cautarea a fost oprita — rezultatele sunt partiale");
      setLoadMoreWarnings(warnings);
      setLoadMoreDone(true);
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        // State already updated incrementally via onBatch — nothing to do
      } else {
        onStateChange((prev) => ({
          ...prev,
          error: e instanceof Error ? e.message : "Eroare la incarcarea extinsa",
        }));
      }
    } finally {
      loadMoreAbort.current = null;
      setLoadingMore(false);
      setLoadMoreProgress(null);
    }
  };

  const handleStopLoadMore = () => {
    loadMoreAbort.current?.abort();
  };

  // Handle pending search from history
  useEffect(() => {
    if (pendingSearch && !loading) {
      consumePendingSearch?.();
      handleSearch(pendingSearch);
    }
  }, [pendingSearch]);

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Termene & Calendar</h1>
        </div>
        {state.allTermene.length > 0 && (
          <div className="flex gap-1 rounded-lg border border-border bg-muted p-1">
            <Button variant={viewMode === "table" ? "default" : "ghost"} size="sm" onClick={() => setViewMode("table")}>
              Tabel
            </Button>
            <Button variant={viewMode === "calendar" ? "default" : "ghost"} size="sm" onClick={() => setViewMode("calendar")}>
              Calendar
            </Button>
          </div>
        )}
      </div>

      <SearchForm
        onSearch={handleSearch}
        loading={loading}
        showDateRange
        onDateChange={(start, stop) => setDateFilter({ start, stop })}
        onCategoriiChange={(cats) => onStateChange({ ...state, categorii: cats })}
        onStadiiChange={(st) => onStateChange({ ...state, stadii: st })}
        showLoadMore={!loading && state.searched && !state.error && initialDosareCount >= 1000 && !loadMoreDone}
        loadingMore={loadingMore}
        onLoadMore={handleLoadMore}
        onStopLoadMore={handleStopLoadMore}
        loadMoreProgress={loadMoreProgress}
        loadMoreLabel="termene"
        loadMoreMessage={!loading && !loadingMore && state.searched && !state.error && initialDosareCount >= 1000 && !loadMoreDone
          ? `Cautarea a gasit dosare la limita de 1.000 — termenele afisate pot fi incomplete. Apasati "Incarca mai multe" pentru a aduce toate termenele.`
          : undefined}
        loadMoreDone={loadMoreDone}
        loadMoreTotal={loadMoreDone ? state.allTermene.length : undefined}
        loadMoreWarnings={loadMoreWarnings}
        defaultParams={state.lastSearchParams}
        onReset={() => {
          setLoadMoreDone(false);
          setLoadMoreWarnings([]);
          setLoadMoreProgress(null);
          setInitialDosareCount(0);
          setMetricFilters([]);
          setDateFilter({});
          lastSearchParams.current = null;
          onStateChange({
            allTermene: [],
            categorii: [],
            stadii: [],
            searched: false,
            error: null,
          });
        }}
      />

      {loading && (
        <div className="flex items-center justify-center gap-3 py-16 text-muted-foreground">
          <Spinner />
          <span className="text-sm">Se cauta termene in PortalJust...</span>
        </div>
      )}

      {state.error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900/50 dark:bg-red-900/10">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-500" />
          <div>
            <p className="text-sm font-medium text-red-800 dark:text-red-400">Eroare la cautare</p>
            <p className="text-xs text-red-700 dark:text-red-500">{state.error}</p>
          </div>
        </div>
      )}

      {!loading && state.searched && !state.error && state.allTermene.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <CalendarDays className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm font-medium text-muted-foreground">Niciun termen gasit</p>
          <p className="text-xs text-muted-foreground">Dosarele gasite nu au sedinte inregistrate</p>
        </div>
      )}

      {!loading && state.allTermene.length > 0 && (
        <Suspense fallback={<div className="py-6 text-center text-xs text-muted-foreground">Se incarca graficele...</div>}>
          <TermeneMetrics
            termene={filteredByCatStadiu}
            activeFilters={metricFilters}
            onFilterToggle={toggleMetricFilter}
            onClearFilters={() => setMetricFilters([])}
          />
        </Suspense>
      )}

      {!loading && state.allTermene.length > 0 && (
        viewMode === "table"
          ? <TermeneTable termene={termene} onExportExcel={(sel) => exportTermeneExcel(sel || termene)} onExportPDF={(sel) => exportTermenePDF(sel || termene)} searchedName={state.searchedName} />
          : <CalendarView termene={termene} />
      )}

      {!state.searched && !loading && (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <CalendarDays className="h-10 w-10 text-muted-foreground/20" />
          <p className="text-sm text-muted-foreground">Cautati dosare pentru a vedea termenele asociate</p>
        </div>
      )}
    </div>
  );
}

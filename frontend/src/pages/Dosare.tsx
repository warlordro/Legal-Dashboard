import { lazy, Suspense, useState, useEffect, useRef } from "react";
import { FileSearch, AlertTriangle } from "lucide-react";
import { SearchForm } from "@/components/SearchForm";
import { DosareTable } from "@/components/DosareTable";
// Lazy: MetricsPanel pulls in recharts (heavy). Only mounts after a successful search.
const MetricsPanel = lazy(() => import("@/components/MetricsPanel").then((m) => ({ default: m.MetricsPanel })));
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { LoadMoreProgress } from "@/lib/api";
import { exportDosareExcel, exportDosarePDF } from "@/lib/export";
import type { Dosar, SearchParams } from "@/types";
import type { ApiKeys } from "@/hooks/useApiKey";
import { INSTITUTII, normalizeInstitutie } from "@/lib/institutii";

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

const KNOWN_CATEGORII = ["penal", "civil", "contencios administrativ", "litigii de munc", "faliment", "litigii cu profesioni"];

function filterByCategorii(dosare: Dosar[], categorii: string[]): Dosar[] {
  if (categorii.length === 0) return dosare;
  const hasAltele = categorii.includes("Altele");
  const realCats = categorii.filter((c) => c !== "Altele");
  return dosare.filter((d) => {
    const cat = (d.categorieCaz ?? "").toLowerCase();
    const matchesReal = realCats.some((c) => cat.includes(c.toLowerCase()));
    const matchesAltele = hasAltele && !KNOWN_CATEGORII.some((k) => cat.includes(k));
    return matchesReal || matchesAltele;
  });
}

function filterByStadii(dosare: Dosar[], stadii: string[]): Dosar[] {
  if (stadii.length === 0) return dosare;
  return dosare.filter((d) => {
    const stadiu = (d.stadiuProcesual ?? "").toLowerCase();
    return stadii.some((s) => stadiu.includes(s.toLowerCase()));
  });
}

function filterByRoles(dosare: Dosar[], roles: string[], searchedName?: string): Dosar[] {
  if (roles.length === 0 || !searchedName) return dosare;
  const searchWords = stripDiacritics(searchedName.toLowerCase()).trim().split(/\s+/).filter(Boolean);
  return dosare.filter((d) =>
    d.parti.some(
      (p) => searchWords.every((w) => stripDiacritics(p.nume.toLowerCase()).includes(w)) && roles.includes(p.calitateParte)
    )
  );
}

function filterByDate(dosare: Dosar[], dataStart?: string, dataStop?: string): Dosar[] {
  if (!dataStart && !dataStop) return dosare;
  return dosare.filter((d) => {
    if (!d.data) return true;
    if (dataStart && d.data < dataStart) return false;
    if (dataStop && d.data > dataStop) return false;
    return true;
  });
}

function filterByInstitutii(dosare: Dosar[], institutii: string[]): Dosar[] {
  if (institutii.length === 0) return dosare;
  // institutii = SOAP enum values (e.g. "TribunalulSATUMARE")
  // d.institutie = raw text from XML (e.g. "Tribunalul SATUMARE")
  // Normalize both sides for matching
  const selectedLabels = new Set(
    institutii.map((val) => {
      const inst = INSTITUTII.find((i) => i.value === val);
      return inst ? inst.label : val;
    })
  );
  return dosare.filter((d) => selectedLabels.has(normalizeInstitutie(d.institutie ?? "")));
}

interface DosareState {
  allDosare: Dosar[];
  categorii: string[];
  stadii: string[];
  institutii: string[];
  searched: boolean;
  error: string | null;
  searchedName?: string;
  lastSearchParams?: SearchParams;
}

interface DosareProps {
  state: DosareState;
  onStateChange: React.Dispatch<React.SetStateAction<DosareState>>;
  onSearchComplete?: (params: SearchParams, resultCount: number) => void;
  pendingSearch?: SearchParams | null;
  consumePendingSearch?: () => void;
  apiKeys?: ApiKeys;
  onConfigureApiKey?: () => void;
}

export default function Dosare({ state, onStateChange, onSearchComplete, pendingSearch, consumePendingSearch, apiKeys, onConfigureApiKey }: DosareProps) {
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreProgress, setLoadMoreProgress] = useState<LoadMoreProgress | null>(null);
  const [loadMoreWarnings, setLoadMoreWarnings] = useState<string[]>([]);
  const [loadMoreDone, setLoadMoreDone] = useState(false);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [dateFilter, setDateFilter] = useState<{ start?: string; stop?: string }>({});
  const lastSearchParams = useRef<SearchParams | null>(state.lastSearchParams ?? null);
  const loadMoreAbort = useRef<AbortController | null>(null);

  const filteredByInst = filterByInstitutii(state.allDosare, state.institutii ?? []);
  const filteredByDate = filterByDate(filteredByInst, dateFilter.start, dateFilter.stop);
  const filteredByCategAndStadiu = filterByStadii(filterByCategorii(filteredByDate, state.categorii), state.stadii ?? []);
  const dosare = filterByRoles(filteredByCategAndStadiu, selectedRoles, state.searchedName);

  const handleSearch = async (params: SearchParams) => {
    setLoading(true);
    setSelectedRoles([]);
    setDateFilter({});
    setLoadMoreDone(false);
    setLoadMoreWarnings([]);
    setLoadMoreProgress(null);
    onStateChange({ ...state, error: null, searched: true });
    try {
      const { categorii: cats, stadii: st, ...searchParams } = params;
      lastSearchParams.current = searchParams;
      const res = await api.dosare.search(searchParams);
      onStateChange({
        allDosare: res.data,
        categorii: cats ?? [],
        stadii: st ?? [],
        institutii: [],
        searched: true,
        error: null,
        searchedName: searchParams.numeParte || undefined,
        lastSearchParams: params,
      });
      onSearchComplete?.(params, res.data.length);
    } catch (e) {
      onStateChange({
        allDosare: [],
        categorii: state.categorii,
        stadii: state.stadii,
        institutii: state.institutii,
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

    // Send existing dosare numbers to backend so it only returns NEW ones
    const existingNumere = state.allDosare.map((d) => d.numar);
    // Track new dosare incrementally — start from current state
    const allDosare = [...state.allDosare];
    const knownNr = new Set(existingNumere);
    let newCount = 0;

    try {
      const result = await api.dosare.loadMore(
        lastSearchParams.current,
        (progress) => setLoadMoreProgress({
          ...progress,
          found: newCount,
        }),
        abort.signal,
        (batch) => {
          // Backend already filters out existing — these are all new
          for (const d of batch) {
            if (!knownNr.has(d.numar)) {
              knownNr.add(d.numar);
              allDosare.push(d);
              newCount++;
            }
          }
          // Functional update: don't capture stale `state`. Filter/category changes that landed
          // mid-stream stay intact; we only overwrite allDosare.
          onStateChange((prev) => ({
            ...prev,
            allDosare: [...allDosare],
          }));
        },
        existingNumere,
      );
      // Final pass (in case any items weren't in batch events)
      for (const d of result.data) {
        if (!knownNr.has(d.numar)) {
          knownNr.add(d.numar);
          allDosare.push(d);
          newCount++;
        }
      }
      onStateChange((prev) => ({
        ...prev,
        allDosare: [...allDosare],
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

  const handleCategoriiChange = (cats: string[]) => {
    onStateChange({ ...state, categorii: cats });
  };

  const handleStadiiChange = (st: string[]) => {
    onStateChange({ ...state, stadii: st });
  };

  const handleInstitutiiChange = (inst: string[]) => {
    onStateChange({ ...state, institutii: inst });
  };

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-center gap-2">
        <FileSearch className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Cautare Dosare</h1>
      </div>

      <SearchForm
        onSearch={handleSearch}
        onCategoriiChange={handleCategoriiChange}
        onStadiiChange={handleStadiiChange}
        onInstitutiiChange={handleInstitutiiChange}
        onDateChange={(start, stop) => setDateFilter({ start, stop })}
        loading={loading}
        showDateRange
        showLoadMore={!loading && state.searched && !state.error && state.allDosare.length >= 1000 && !loadMoreDone}
        loadingMore={loadingMore}
        onLoadMore={handleLoadMore}
        onStopLoadMore={handleStopLoadMore}
        loadMoreProgress={loadMoreProgress}
        loadMoreMessage={!loading && !loadingMore && state.searched && !state.error && state.allDosare.length >= 1000 && !loadMoreDone
          ? `Cautarea a returnat ${state.allDosare.length.toLocaleString("ro-RO")} rezultate — este posibil sa existe mai multe. Apasati "Incarca mai multe" pentru a aduce toate dosarele.`
          : undefined}
        loadMoreDone={loadMoreDone}
        loadMoreTotal={loadMoreDone ? state.allDosare.length : undefined}
        loadMoreWarnings={loadMoreWarnings}
        defaultParams={state.lastSearchParams}
        onReset={() => {
          setLoadMoreDone(false);
          setLoadMoreWarnings([]);
          setLoadMoreProgress(null);
          setSelectedRoles([]);
          setDateFilter({});
          lastSearchParams.current = null;
          onStateChange({
            allDosare: [],
            categorii: [],
            stadii: [],
            institutii: [],
            searched: false,
            error: null,
          });
        }}
      />

      {loading && (
        <div className="flex items-center justify-center gap-3 py-16 text-muted-foreground">
          <Spinner />
          <span className="text-sm">Se cauta in baza de date PortalJust...</span>
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

      {!loading && state.searched && !state.error && dosare.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <FileSearch className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm font-medium text-muted-foreground">Niciun dosar gasit</p>
          <p className="text-xs text-muted-foreground">Incercati alti parametri de cautare</p>
        </div>
      )}

      {!loading && filteredByCategAndStadiu.length > 0 && (
        <Suspense fallback={<div className="py-6 text-center text-xs text-muted-foreground">Se incarca graficele...</div>}>
          <MetricsPanel
            dosare={filteredByCategAndStadiu}
            searchedName={state.searchedName}
            selectedRoles={selectedRoles}
            onRoleFilter={(role) => setSelectedRoles((prev) => prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role])}
          />
        </Suspense>
      )}

      {!loading && dosare.length > 0 && (
        <DosareTable
          dosare={dosare}
          onExportExcel={(sel) => exportDosareExcel(sel || dosare)}
          onExportPDF={(sel) => exportDosarePDF(sel || dosare)}
          searchedName={state.searchedName}
          apiKeys={apiKeys}
          onConfigureApiKey={onConfigureApiKey}
        />
      )}

      {!state.searched && !loading && (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <FileSearch className="h-10 w-10 text-muted-foreground/20" />
          <p className="text-sm text-muted-foreground">Introduceti criteriile de cautare pentru a gasi dosare</p>
        </div>
      )}
    </div>
  );
}

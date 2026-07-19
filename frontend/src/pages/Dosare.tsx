import { lazy, Suspense, useState, useEffect, useRef, useMemo } from "react";
import { FileSearch, AlertTriangle } from "lucide-react";
import { SearchForm } from "@/components/SearchForm";
import { DosareTable } from "@/components/DosareTable";
import { BudgetIndicator } from "@/components/BudgetIndicator";
// Lazy: MetricsPanel pulls in recharts (heavy). Only mounts after a successful search.
const MetricsPanel = lazy(() => import("@/components/MetricsPanel").then((m) => ({ default: m.MetricsPanel })));
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import type { LoadMoreProgress } from "@/lib/api";
import { exportDosareExcel, exportDosarePDF } from "@/lib/export-dosare";
import type { Dosar, DosarSource, SearchParams } from "@/types";
import type { ApiKeys } from "@/hooks/useApiKey";
import type { AiMode } from "@/components/dosare-ai-config";
import { INSTITUTII, normalizeInstitutie, getInstitutieLabel } from "@/lib/institutii";
import { dropLegalFormTokens } from "@/lib/legalSuffix";

function stripDiacritics(s: string): string {
  // biome-ignore lint/suspicious/noMisleadingCharacterClass: range-ul combina diacriticele dupa normalizare NFD.
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

const KNOWN_CATEGORII = [
  "penal",
  "civil",
  "contencios administrativ",
  "litigii de munc",
  "faliment",
  "litigii cu profesioni",
];

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
  const rawWords = stripDiacritics(searchedName.toLowerCase()).trim().split(/\s+/).filter(Boolean);
  const filtered = dropLegalFormTokens(rawWords);
  const searchWords = filtered.length > 0 ? filtered : rawWords;
  return dosare.filter((d) =>
    d.parti.some(
      (p) =>
        searchWords.every((w) => stripDiacritics(p.nume.toLowerCase()).includes(w)) && roles.includes(p.calitateParte)
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

function formatFailedInstitutii(tokens: string[]): string {
  const labels = tokens.map((t) => getInstitutieLabel(t));
  if (labels.length <= 3) return labels.join(", ");
  return `${labels.slice(0, 3).join(", ")} si alte ${labels.length - 3} instante`;
}

interface DosareState {
  allDosare: Dosar[];
  categorii: string[];
  stadii: string[];
  institutii: string[];
  searched: boolean;
  error: string | null;
  searchedName?: string;
  failedInstitutii?: string[];
  lastSearchParams?: SearchParams;
}

interface DosareProps {
  state: DosareState;
  onStateChange: React.Dispatch<React.SetStateAction<DosareState>>;
  onSearchComplete?: (
    params: SearchParams,
    resultCount: number,
    meta?: { categoriesCount: number; institutiiCount: number }
  ) => void;
  pendingSearch?: SearchParams | null;
  consumePendingSearch?: () => void;
  apiKeys?: ApiKeys;
  aiSettings: { mode: AiMode };
  onConfigureApiKey?: () => void;
  showBudgetIndicator?: boolean;
}

export default function Dosare({
  state,
  onStateChange,
  onSearchComplete,
  pendingSearch,
  consumePendingSearch,
  apiKeys,
  aiSettings,
  onConfigureApiKey,
  showBudgetIndicator = false,
}: DosareProps) {
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreProgress, setLoadMoreProgress] = useState<LoadMoreProgress | null>(null);
  const [loadMoreWarnings, setLoadMoreWarnings] = useState<string[]>([]);
  const [loadMoreDone, setLoadMoreDone] = useState(false);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [dateFilter, setDateFilter] = useState<{ start?: string; stop?: string }>({});
  // ICCJ live-proxy is paginated (page/hasMore), not SSE like PortalJust load-more.
  const [iccjPaging, setIccjPaging] = useState<{ page: number; hasMore: boolean; total: number } | null>(null);
  // In-flight source for the loading spinner label. Committed `isIccj` (from
  // lastSearchParams) lags until results commit, so it would mislabel the spinner
  // on the first search / right after a source switch. MUST be set wherever
  // setLoading(true) is — today only at the top of handleSearch.
  const [loadingSource, setLoadingSource] = useState<DosarSource>("portaljust");
  const lastSearchParams = useRef<SearchParams | null>(state.lastSearchParams ?? null);
  const loadMoreAbort = useRef<AbortController | null>(null);

  // ICCJ dosare carry ISO dates (iccjDateToIso) just like PortalJust, so the same
  // client-side facets apply. We only skip filterByInstitutii for ICCJ (its `institutie`
  // is a single constant; the SOAP-enum institutie filter is meaningless there).
  // Stadiu/Categorie chips for ICCJ are derived dynamically from the loaded result set
  // (the static PortalJust vocabulary does not match ICCJ values); Categorie + role
  // facets only become populated after Tier-2 detail enrichment.
  const isIccj = (state.lastSearchParams?.source ?? "portaljust") === "iccj";
  const baseDosare = isIccj ? state.allDosare : filterByInstitutii(state.allDosare, state.institutii ?? []);
  const filteredByDate = filterByDate(baseDosare, dateFilter.start, dateFilter.stop);
  const filteredByCategAndStadiu = filterByStadii(
    filterByCategorii(filteredByDate, state.categorii),
    state.stadii ?? []
  );
  const dosare = filterByRoles(filteredByCategAndStadiu, selectedRoles, state.searchedName);

  // Dynamic ICCJ facet vocabularies (distinct values from the loaded set). Empty until
  // a search lands; categorii stays empty until detail enrichment fills categorieCaz.
  const iccjStadiiOptions = useMemo(
    () =>
      isIccj
        ? Array.from(new Set(state.allDosare.map((d) => d.stadiuProcesual).filter(Boolean))).sort((a, b) =>
            a.localeCompare(b, "ro")
          )
        : [],
    [isIccj, state.allDosare]
  );
  const iccjCategoriiOptions = useMemo(
    () =>
      isIccj
        ? Array.from(new Set(state.allDosare.map((d) => d.categorieCaz).filter(Boolean))).sort((a, b) =>
            a.localeCompare(b, "ro")
          )
        : [],
    [isIccj, state.allDosare]
  );

  const handleSearch = async (params: SearchParams) => {
    setLoading(true);
    setLoadingSource(params.source === "iccj" ? "iccj" : "portaljust");
    setSelectedRoles([]);
    setDateFilter({});
    setLoadMoreDone(false);
    setLoadMoreWarnings([]);
    setLoadMoreProgress(null);
    setIccjPaging(null);
    onStateChange({ ...state, error: null, searched: true, failedInstitutii: [] });
    try {
      const { categorii: cats, stadii: st, ...searchParams } = params;
      lastSearchParams.current = searchParams;

      // ICCJ live-proxy path (separate endpoint, paginated, no client-side filters).
      if (searchParams.source === "iccj") {
        const res = await api.dosare.searchIccj(searchParams, 1);
        onStateChange({
          allDosare: res.data,
          categorii: [],
          stadii: [],
          institutii: [],
          searched: true,
          error: null,
          searchedName: searchParams.numeParte || undefined,
          failedInstitutii: [],
          lastSearchParams: params,
        });
        // hasMore is derived cumulatively (backend no longer guesses page size):
        // page 1 added all res.data rows, so there is more iff we have fewer than total.
        setIccjPaging({
          page: res.page,
          hasMore: res.data.length > 0 && res.data.length < res.total,
          total: res.total,
        });
        onSearchComplete?.(params, res.total, { categoriesCount: 0, institutiiCount: 1 });
        return;
      }

      const res = await api.dosare.search(searchParams);
      onStateChange({
        allDosare: res.data,
        categorii: cats ?? [],
        stadii: st ?? [],
        institutii: [],
        searched: true,
        error: null,
        searchedName: searchParams.numeParte || undefined,
        failedInstitutii: res.failedInstitutii ?? [],
        lastSearchParams: params,
      });
      const catSet = new Set<string>();
      const instSet = new Set<string>();
      for (const d of res.data) {
        if (d.categorieCaz) catSet.add(d.categorieCaz);
        if (d.institutie) instSet.add(d.institutie);
      }
      onSearchComplete?.(params, res.data.length, {
        categoriesCount: catSet.size,
        institutiiCount: instSet.size,
      });
    } catch (e) {
      onStateChange({
        allDosare: [],
        categorii: state.categorii,
        stadii: state.stadii,
        institutii: state.institutii,
        searched: true,
        error: e instanceof Error ? e.message : "Eroare la cautare",
        failedInstitutii: [],
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
        (progress) =>
          setLoadMoreProgress({
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
        existingNumere
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

  // ICCJ "next page": fetch the next page and append (dedup by iccjId). Unlike
  // PortalJust load-more (SSE month-sweep), this is plain pagination over the
  // date-DESC result set; the UI shows page-by-page, never auto-sweeps 1000.
  const handleIccjNextPage = async () => {
    if (!lastSearchParams.current || !iccjPaging?.hasMore) return;
    setLoadingMore(true);
    try {
      const res = await api.dosare.searchIccj(lastSearchParams.current, iccjPaging.page + 1);
      const known = new Set(state.allDosare.map((d) => d.iccjId ?? d.numar));
      const merged = [...state.allDosare];
      let addedNew = 0;
      for (const d of res.data) {
        const key = d.iccjId ?? d.numar;
        if (!known.has(key)) {
          known.add(key);
          merged.push(d);
          addedNew++;
        }
      }
      onStateChange((prev) => ({ ...prev, allDosare: merged }));
      // Stop offering "load more" when the page was empty, added nothing new (dedup
      // stall at a page boundary), or we have reached the server-reported total.
      setIccjPaging({
        page: res.page,
        hasMore: res.data.length > 0 && addedNew > 0 && merged.length < res.total,
        total: res.total,
      });
    } catch (e) {
      onStateChange((prev) => ({
        ...prev,
        error: e instanceof Error ? e.message : "Eroare la incarcarea paginii ICCJ",
      }));
    } finally {
      setLoadingMore(false);
    }
  };

  // Handle pending search from history. Re-fires cand pendingSearch sau loading se schimba,
  // ca sa nu pierdem un trigger sosit in timpul unei cautari deja in curs.
  // biome-ignore lint/correctness/useExhaustiveDependencies: consumePendingSearch + handleSearch nu sunt memoizate; consumam valoarea curenta in callback.
  useEffect(() => {
    if (pendingSearch && !loading) {
      consumePendingSearch?.();
      handleSearch(pendingSearch);
    }
  }, [pendingSearch, loading]);

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
        showSourceToggle
        iccjStadiiOptions={iccjStadiiOptions}
        iccjCategoriiOptions={iccjCategoriiOptions}
        showLoadMore={
          isIccj
            ? !loading && !!iccjPaging?.hasMore
            : !loading && state.searched && !state.error && state.allDosare.length >= 1000 && !loadMoreDone
        }
        loadingMore={loadingMore}
        onLoadMore={isIccj ? handleIccjNextPage : handleLoadMore}
        onStopLoadMore={handleStopLoadMore}
        loadMoreProgress={isIccj ? null : loadMoreProgress}
        loadMoreMessage={
          isIccj
            ? iccjPaging && !loading && !loadingMore
              ? `ICCJ: ${state.allDosare.length} din ${iccjPaging.total.toLocaleString("ro-RO")} rezultate (pagina ${iccjPaging.page})${iccjPaging.hasMore ? ' — apasati "Incarca mai multe"' : ""}`
              : undefined
            : !loading &&
                !loadingMore &&
                state.searched &&
                !state.error &&
                state.allDosare.length >= 1000 &&
                !loadMoreDone
              ? `Cautarea a returnat ${state.allDosare.length.toLocaleString("ro-RO")} rezultate — este posibil sa existe mai multe. Apasati "Incarca mai multe" pentru a aduce toate dosarele.`
              : undefined
        }
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
          setIccjPaging(null);
          lastSearchParams.current = null;
          onStateChange({
            allDosare: [],
            categorii: [],
            stadii: [],
            institutii: [],
            searched: false,
            error: null,
            failedInstitutii: [],
          });
        }}
      />

      {loading && (
        <div className="flex items-center justify-center gap-3 py-16 text-muted-foreground">
          <Spinner />
          <span className="text-sm">
            {loadingSource === "iccj"
              ? "Se cauta in baza de date ICCJ (scj.ro)..."
              : "Se cauta in baza de date PortalJust..."}
          </span>
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

      {state.searched && !loading && !state.error && (state.failedInstitutii?.length ?? 0) > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/40">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-400">Unele instante nu au raspuns</p>
          <p className="text-sm text-amber-700 dark:text-amber-300">
            {formatFailedInstitutii(state.failedInstitutii ?? [])} — rezultatele acestor instante lipsesc din lista.
            Incercati din nou mai tarziu.
          </p>
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
        <Suspense
          fallback={<div className="py-6 text-center text-xs text-muted-foreground">Se incarca graficele...</div>}
        >
          <MetricsPanel
            dosare={filteredByCategAndStadiu}
            source={isIccj ? "iccj" : "portaljust"}
            searchedName={state.searchedName}
            selectedRoles={selectedRoles}
            onRoleFilter={(role) =>
              setSelectedRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]))
            }
          />
        </Suspense>
      )}

      {/* ICCJ metrics cover only the loaded pages — be explicit so partial stats aren't
          misread as complete (PortalJust loads up to 1000 in one shot, ICCJ paginates). */}
      {!loading && isIccj && iccjPaging && state.allDosare.length < iccjPaging.total && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Metrici pentru {state.allDosare.length} din {iccjPaging.total.toLocaleString("ro-RO")} dosare incarcate —
          apasati &quot;Incarca mai multe&quot; pentru a le include pe toate.
        </p>
      )}

      {!loading && dosare.length > 0 && (
        <DosareTable
          dosare={dosare}
          onExportExcel={(sel) => {
            if (
              (state.failedInstitutii?.length ?? 0) > 0 &&
              !window.confirm(
                "Rezultatele sunt PARTIALE (instante fara raspuns la cautare). Exporti totusi lista incompleta?"
              )
            )
              return;
            exportDosareExcel(sel || dosare);
          }}
          onExportPDF={(sel) => exportDosarePDF(sel || dosare)}
          searchedName={state.searchedName}
          apiKeys={apiKeys}
          aiSettings={aiSettings}
          onConfigureApiKey={onConfigureApiKey}
        />
      )}

      {!state.searched && !loading && (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <FileSearch className="h-10 w-10 text-muted-foreground/20" />
          <p className="text-sm text-muted-foreground">Introduceti criteriile de cautare pentru a gasi dosare</p>
        </div>
      )}

      <BudgetIndicator enabled={showBudgetIndicator} />
    </div>
  );
}

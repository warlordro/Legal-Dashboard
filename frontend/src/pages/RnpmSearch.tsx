import { useEffect, useRef, useState } from "react";
import { FileLock2, ListChecks, Database, Key } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

import { RnpmSearchForm } from "@/components/rnpm/RnpmSearchForm";
import { RnpmResultsTable } from "@/components/rnpm/RnpmResultsTable";
import { RnpmBulkSearch } from "@/components/rnpm/RnpmBulkSearch";
import { RnpmSavedData } from "@/components/rnpm/RnpmSavedData";
import { RnpmSavedStats } from "@/components/rnpm/RnpmSavedStats";
import { RnpmDetailModal } from "@/components/rnpm/RnpmDetailModal";
import { RnpmSplitDialog } from "@/components/rnpm/RnpmSplitDialog";
import { rnpmSearch, rnpmSplitSearch, RnpmLimitExceededError } from "@/lib/rnpmApi";
import { describeBlockedSubResult } from "@/lib/rnpmGapReason";
import { describeNestedPhase, describeSplitPhase, formatSplitProgress } from "@/lib/rnpmProgressPhase";
import type {
  RnpmSearchParams,
  RnpmSearchType,
  RnpmDocument,
  RnpmSplitSubResult,
  RnpmSplitProgress,
} from "@/types/rnpm";
import type { CaptchaProvider, CaptchaMode } from "@/lib/rnpmApi";

type Tab = "search" | "bulk" | "saved";

const BATCH_SIZE = 25;

export interface RnpmSearchPageProps {
  captchaKey: string;
  captchaProvider: CaptchaProvider;
  fallback2CaptchaKey?: string;
  captchaMode?: CaptchaMode;
  onConfigureKey: () => void;
  onSearchComplete: (type: RnpmSearchType, params: RnpmSearchParams, resultCount: number) => void;
  pendingSearch: { type: RnpmSearchType; params: RnpmSearchParams } | null;
  consumePendingSearch: () => void;
}

interface ResultState {
  searchId: number;
  total: number;
  pagesTotal: number;
  pageSize: number;
  criteriu: string;
  documents: RnpmDocument[];
  avizIds: (number | null)[];
  detailsFailed: string[];
  gcode: string;
  nextRnpmPage: number | null;
  // Marcat doar cand rezultatul vine din executeSplitSearch — dezactiveaza
  // "Incarca tot" (split-ul agrega deja paginile) si activeaza badge-ul + warnings.
  splitMode?: boolean;
  splitStats?: RnpmSplitSubResult[];
  upstreamTotal?: number;
}

interface PendingSplit {
  type: RnpmSearchType;
  params: RnpmSearchParams;
  total: number | undefined;
  limit: number | undefined;
}

export default function RnpmSearchPage({
  captchaKey,
  captchaProvider,
  fallback2CaptchaKey,
  captchaMode,
  onConfigureKey,
  onSearchComplete,
  pendingSearch,
  consumePendingSearch,
}: RnpmSearchPageProps) {
  const [tab, setTab] = useState<Tab>("search");
  const [activeSearchType, setActiveSearchType] = useState<RnpmSearchType>("ipoteci");
  const [lastType, setLastType] = useState<RnpmSearchType>("ipoteci");
  const [lastParams, setLastParams] = useState<RnpmSearchParams>({});
  const [result, setResult] = useState<ResultState | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [detailAvizId, setDetailAvizId] = useState<number | null>(null);
  const [savedRefreshKey, setSavedRefreshKey] = useState(0);
  const [savedStatsKey, setSavedStatsKey] = useState(0);
  const [formResetKey, setFormResetKey] = useState(0);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [autoLoading, setAutoLoading] = useState(false);
  const [pendingSplit, setPendingSplit] = useState<PendingSplit | null>(null);
  const [splitProgress, setSplitProgress] = useState<RnpmSplitProgress | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === "AbortError";

  const stoppedRef = useRef(false);

  const runSearch = async (type: RnpmSearchType, params: RnpmSearchParams) => {
    if (!captchaKey) {
      onConfigureKey();
      return;
    }
    if (abortRef.current) return;
    const ctl = new AbortController();
    abortRef.current = ctl;
    stoppedRef.current = false;
    setLoading(true);
    setError(null);
    setResult(null);
    setElapsedMs(null);
    setPhase("Rezolvare captcha...");
    setActiveSearchType(type);
    setLastType(type);
    setLastParams(params);
    const startTs = performance.now();
    try {
      setPhase("Interogare RNPM...");
      const res = await rnpmSearch(
        type,
        params,
        captchaKey,
        { batchSize: BATCH_SIZE, captchaProvider, fallback2CaptchaKey, captchaMode },
        ctl.signal
      );
      if (stoppedRef.current || ctl.signal.aborted) return;
      setElapsedMs(Math.round(performance.now() - startTs));
      setPhase("Salvare in baza locala...");
      setResult({
        searchId: res.searchId,
        total: res.total,
        pagesTotal: res.pagesTotal,
        pageSize: res.pageSize,
        criteriu: res.criteriu,
        documents: res.documents,
        avizIds: res.avizIds,
        detailsFailed: res.detailsFailed,
        gcode: res.gcode,
        nextRnpmPage: res.nextRnpmPage,
      });
      setSavedRefreshKey((k) => k + 1);
      onSearchComplete(type, params, res.total);
    } catch (e) {
      if (isAbort(e) || ctl.signal.aborted) {
        // intentional cancel — ignore
      } else if (e instanceof RnpmLimitExceededError) {
        // Deschide dialog de confirmare; userul decide daca platim N captcha-uri.
        setPendingSplit({ type, params, total: e.total, limit: e.limit });
      } else {
        setError(e instanceof Error ? e.message : "Eroare necunoscuta");
      }
    } finally {
      if (abortRef.current === ctl) abortRef.current = null;
      setLoading(false);
      setPhase("");
    }
  };

  const runSplit = async (subTypeLabels: string[]) => {
    if (!pendingSplit) return;
    if (!captchaKey) {
      onConfigureKey();
      return;
    }
    if (abortRef.current) return;
    const { type, params } = pendingSplit;
    setPendingSplit(null);
    const ctl = new AbortController();
    abortRef.current = ctl;
    stoppedRef.current = false;
    setLoading(true);
    setError(null);
    setResult(null);
    setElapsedMs(null);
    setSplitProgress({
      index: 0,
      total: subTypeLabels.length,
      label: subTypeLabels[0] ?? "",
      phase: "captcha",
    } as RnpmSplitProgress);
    setPhase(`Pregatire split ${subTypeLabels.length} sub-tipuri...`);
    setActiveSearchType(type);
    setLastType(type);
    setLastParams(params);
    const startTs = performance.now();
    try {
      const res = await rnpmSplitSearch(
        type,
        params,
        subTypeLabels,
        captchaKey,
        (p) => {
          setSplitProgress(p);
          setPhase(formatSplitProgress(p));
        },
        ctl.signal,
        captchaProvider,
        fallback2CaptchaKey,
        captchaMode
      );
      if (stoppedRef.current || ctl.signal.aborted) return;
      setElapsedMs(Math.round(performance.now() - startTs));
      setResult({
        searchId: res.searchId,
        total: res.total,
        pagesTotal: res.pagesTotal,
        pageSize: res.pageSize,
        criteriu: res.criteriu,
        documents: res.documents,
        avizIds: res.avizIds,
        detailsFailed: res.detailsFailed,
        gcode: "",
        nextRnpmPage: null,
        splitMode: true,
        splitStats: res.splitStats,
        upstreamTotal: res.upstreamTotal,
      });
      setSavedRefreshKey((k) => k + 1);
      onSearchComplete(type, params, res.total);
    } catch (e) {
      if (!isAbort(e) && !ctl.signal.aborted) setError(e instanceof Error ? e.message : "Eroare necunoscuta");
    } finally {
      if (abortRef.current === ctl) abortRef.current = null;
      setLoading(false);
      setPhase("");
      setSplitProgress(null);
    }
  };

  const loadNextBatch = async () => {
    if (!result || !captchaKey || result.nextRnpmPage == null || loading) return;
    if (abortRef.current) return;
    const ctl = new AbortController();
    abortRef.current = ctl;
    stoppedRef.current = false;
    setLoading(true);
    setError(null);
    setPhase(`Incarca urmatoarele ${BATCH_SIZE} rezultate...`);
    const startTs = performance.now();
    try {
      const res = await rnpmSearch(
        lastType,
        lastParams,
        captchaKey,
        {
          startRnpmPage: result.nextRnpmPage,
          batchSize: BATCH_SIZE,
          gcode: result.gcode,
          searchId: result.searchId,
          captchaProvider,
          fallback2CaptchaKey,
          captchaMode,
        },
        ctl.signal
      );
      if (stoppedRef.current || ctl.signal.aborted) return;
      setElapsedMs((prev) => (prev ?? 0) + Math.round(performance.now() - startTs));
      setResult((prev) =>
        prev
          ? {
              ...prev,
              documents: [...prev.documents, ...res.documents],
              avizIds: [...prev.avizIds, ...res.avizIds],
              detailsFailed: [...prev.detailsFailed, ...res.detailsFailed],
              gcode: res.gcode,
              nextRnpmPage: res.nextRnpmPage,
            }
          : null
      );
      setSavedRefreshKey((k) => k + 1);
    } catch (e) {
      if (!isAbort(e) && !ctl.signal.aborted) {
        setError(e instanceof Error ? e.message : "Eroare necunoscuta");
        setAutoLoading(false);
      }
    } finally {
      if (abortRef.current === ctl) abortRef.current = null;
      setLoading(false);
      setPhase("");
    }
  };

  // Auto-loop: after a batch completes, trigger the next one while autoLoading is on.
  // Stops naturally when nextRnpmPage becomes null; user can cancel via handleStop.
  // biome-ignore lint/correctness/useExhaustiveDependencies: auto-loop-ul urmareste doar pagina urmatoare; callback-ul complet ar re-triggera batch-uri.
  useEffect(() => {
    if (!autoLoading || loading) return;
    if (!result || result.nextRnpmPage == null) {
      setAutoLoading(false);
      return;
    }
    void loadNextBatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoading, loading, result?.nextRnpmPage]);

  const handleStop = () => {
    stoppedRef.current = true;
    abortRef.current?.abort();
    setAutoLoading(false);
    setLoading(false);
    setPhase("");
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: pendingSearch este trigger one-shot pentru istoric; runSearch complet ar reporni cautarea.
  useEffect(() => {
    if (!pendingSearch) return;
    const { type, params } = pendingSearch;
    setTab("search");
    setActiveSearchType(type);
    setLastType(type);
    setLastParams(params);
    setFormResetKey((k) => k + 1);
    void runSearch(type, params);
    consumePendingSearch();
  }, [pendingSearch]);

  const openDetailByAvizId = (id: number | null) => {
    if (id != null) setDetailAvizId(id);
    else
      setError(
        "Detaliile nu sunt disponibile pentru acest aviz (UUID expirat in timpul cautarii). Refa cautarea pentru a reincarca detaliile."
      );
  };

  const tabs: { id: Tab; label: string; icon: typeof FileLock2 }[] = [
    { id: "search", label: "Cautare", icon: FileLock2 },
    { id: "bulk", label: "Bulk", icon: ListChecks },
    { id: "saved", label: "Baza locala", icon: Database },
  ];
  const visibleResult = activeSearchType === lastType ? result : null;
  const visibleError = activeSearchType === lastType ? error : null;

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Cautare RNPM</h1>
          <p className="text-xs text-muted-foreground">
            Registrul National de Publicitate Mobiliara — cautari cu rezolvare captcha automata
          </p>
        </div>
        {!captchaKey && (
          <Button variant="outline" size="sm" onClick={onConfigureKey}>
            <Key className="h-4 w-4" /> Configureaza 2Captcha
          </Button>
        )}
      </div>

      <div className="flex items-end justify-between border-b border-border">
        <div className="flex gap-1">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "flex items-center gap-2 rounded-t-lg px-4 py-2 text-sm font-medium transition-colors",
                tab === id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
        {tab === "saved" && (
          <div className="pb-1">
            <RnpmSavedStats
              refreshKey={savedRefreshKey + savedStatsKey}
              onAfterDeleteAll={() => {
                setSavedRefreshKey((k) => k + 1);
                setResult(null);
                setError(null);
                setElapsedMs(null);
              }}
            />
          </div>
        )}
      </div>

      <div className={tab === "search" ? "space-y-4" : "hidden"}>
        <RnpmSearchForm
          key={formResetKey}
          loading={loading}
          loadingPhase={phase}
          onSubmit={(type, params) => runSearch(type, params)}
          onTypeChange={setActiveSearchType}
          onStop={handleStop}
          onReset={() => {
            setResult(null);
            setError(null);
            setLastParams({});
          }}
          initialType={lastType}
          initialParams={lastParams}
          suppressStop={visibleResult != null && visibleResult.nextRnpmPage != null && !visibleResult.splitMode}
          extraActions={
            visibleResult && visibleResult.nextRnpmPage != null && !visibleResult.splitMode ? (
              <div className="flex items-center gap-2">
                {autoLoading || loading ? (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={handleStop}
                    className="font-normal h-8 px-3 text-xs"
                  >
                    Opreste incarcarea ({visibleResult.documents.length} din {visibleResult.total})
                  </Button>
                ) : (
                  <Button type="button" onClick={() => setAutoLoading(true)} className="font-normal h-8 px-3 text-xs">
                    Incarca tot ({visibleResult.documents.length} din {visibleResult.total})
                  </Button>
                )}
                {visibleResult.total > 0 && (
                  <div className="h-1.5 w-32 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-300"
                      style={{ width: `${Math.round((visibleResult.documents.length / visibleResult.total) * 100)}%` }}
                    />
                  </div>
                )}
              </div>
            ) : null
          }
        />
        {visibleError && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
            {visibleError}
          </div>
        )}
        {visibleResult?.splitMode && visibleResult.splitStats && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300 space-y-1.5">
            <div className="font-medium">
              Cautare rulata in mod split — {visibleResult.documents.length} avize agregate din{" "}
              {visibleResult.splitStats.length} sub-tipuri
              {visibleResult.upstreamTotal != null ? (
                <> (total RNPM raportat: {visibleResult.upstreamTotal}, inclusiv sub-tipuri blocate)</>
              ) : null}
            </div>
            {(() => {
              // v2.18.0: tier-2 breakdown — daca exista sub-tipuri "recovered"/"partial",
              // afisam recap-ul (cate destinatii au reusit + gap-ul total).
              const tier2Stats = visibleResult.splitStats.filter(
                (s) => s.status === "recovered" || s.status === "partial"
              );
              if (tier2Stats.length === 0) return null;
              const totalGap = tier2Stats.reduce((acc, s) => acc + (s.gap ?? 0), 0);
              return (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
                  <div className="font-medium">
                    Tier-2 split (pe destinatieInscriere) aplicat pe {tier2Stats.length} sub-tip(uri):
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {tier2Stats.map((s) => (
                      <li key={s.label} className="truncate">
                        <b>{s.label}</b>: recuperat <b>{s.count}</b>/{s.subTotal}
                        {s.nested ? (
                          <>
                            {" "}
                            ({s.nested.filter((n) => n.status === "ok").length} destinatii OK din {s.nested.length})
                          </>
                        ) : null}
                        {s.gap != null && s.gap > 0 ? (
                          <>
                            {" "}
                            · gap <b>{s.gap}</b>
                          </>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {totalGap > 0 && (
                    <div className="mt-1.5 rounded bg-amber-500/15 p-1.5 text-[11px]">
                      <b>{totalGap}</b> inregistrari fara destinatie atribuita nu au putut fi recuperate (limitarea API
                      RNPM pentru records istorice fara destinatie).
                    </div>
                  )}
                </div>
              );
            })()}
            {visibleResult.splitStats.some((s) => s.status === "blocked" || s.status === "error") && (
              <ul className="mt-1 space-y-0.5">
                {visibleResult.splitStats
                  .filter((s) => s.status === "blocked" || s.status === "error")
                  .map((s) => (
                    <li key={s.label} className="truncate">
                      <b>{s.label}</b>: {describeBlockedSubResult(s)}
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}
        <RnpmResultsTable
          result={visibleResult}
          loading={loading}
          onNeedMore={loadNextBatch}
          onOpenDetail={(_doc, avizId) => openDetailByAvizId(avizId)}
          searchType={lastType}
          dateStart={lastParams.perioadaStart}
          dateEnd={lastParams.perioadaFinal}
          elapsedMs={elapsedMs}
        />
      </div>

      {/* Keep BulkSearch mounted across tab switches so an in-flight bulk doesn't abort
          when the user peeks at "saved" or "search". useEffect cleanup at unmount still
          aborts ctl on real navigation away from RnpmSearch. */}
      <div className={tab === "bulk" ? "" : "hidden"}>
        <RnpmBulkSearch
          captchaKey={captchaKey}
          captchaProvider={captchaProvider}
          fallback2CaptchaKey={fallback2CaptchaKey}
          captchaMode={captchaMode}
          onConfigureKey={onConfigureKey}
          onItemSaved={() => setSavedRefreshKey((k) => k + 1)}
        />
      </div>

      {/* A: keep RnpmSavedData mounted across tab switches so re-entering "saved" is instant */}
      <div className={tab === "saved" ? "" : "hidden"}>
        <RnpmSavedData
          onOpenDetail={setDetailAvizId}
          refreshKey={savedRefreshKey}
          onChanged={() => setSavedStatsKey((k) => k + 1)}
        />
      </div>

      <RnpmDetailModal avizId={detailAvizId} onClose={() => setDetailAvizId(null)} />

      <RnpmSplitDialog
        open={pendingSplit != null}
        type={pendingSplit?.type ?? "ipoteci"}
        total={pendingSplit?.total}
        limit={pendingSplit?.limit}
        captchaProvider={captchaProvider}
        onCancel={() => setPendingSplit(null)}
        onConfirm={(subTypeLabels) => {
          void runSplit(subTypeLabels);
        }}
      />

      {/* Split-mode progress overlay (lightweight; reuses `loading` for the rest of UI) */}
      {splitProgress && (
        <div className="fixed bottom-4 right-4 z-40 max-w-sm rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300 shadow-lg">
          <div className="font-medium">
            Split RNPM {splitProgress.index + 1}/{splitProgress.total}
          </div>
          <div className="truncate text-[11px]">
            {splitProgress.label} - {describeSplitPhase(splitProgress.phase)}
            {splitProgress.nested && (
              <>
                {" -> "}
                {splitProgress.nested.index}/{splitProgress.nested.total} {splitProgress.nested.label} (
                {describeNestedPhase(splitProgress.nested.phase)})
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

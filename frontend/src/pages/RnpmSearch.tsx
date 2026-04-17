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
import { rnpmSearch } from "@/lib/rnpmApi";
import type { RnpmSearchParams, RnpmSearchType, RnpmDocument } from "@/types/rnpm";
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
  const abortRef = useRef<AbortController | null>(null);

  const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === "AbortError";

  const stoppedRef = useRef(false);

  const runSearch = async (type: RnpmSearchType, params: RnpmSearchParams) => {
    if (!captchaKey) { onConfigureKey(); return; }
    if (abortRef.current) return;
    const ctl = new AbortController();
    abortRef.current = ctl;
    stoppedRef.current = false;
    setLoading(true);
    setError(null);
    setResult(null);
    setElapsedMs(null);
    setPhase("Rezolvare captcha...");
    setLastType(type);
    setLastParams(params);
    const startTs = performance.now();
    try {
      setPhase("Interogare RNPM...");
      const res = await rnpmSearch(type, params, captchaKey, { batchSize: BATCH_SIZE, captchaProvider, fallback2CaptchaKey, captchaMode }, ctl.signal);
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
      if (!isAbort(e) && !ctl.signal.aborted) setError(e instanceof Error ? e.message : "Eroare necunoscuta");
    } finally {
      if (abortRef.current === ctl) abortRef.current = null;
      setLoading(false);
      setPhase("");
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
      const res = await rnpmSearch(lastType, lastParams, captchaKey, {
        startRnpmPage: result.nextRnpmPage,
        batchSize: BATCH_SIZE,
        gcode: result.gcode,
        searchId: result.searchId,
        captchaProvider,
        fallback2CaptchaKey,
        captchaMode,
      }, ctl.signal);
      if (stoppedRef.current || ctl.signal.aborted) return;
      setElapsedMs((prev) => (prev ?? 0) + Math.round(performance.now() - startTs));
      setResult((prev) => prev ? {
        ...prev,
        documents: [...prev.documents, ...res.documents],
        avizIds: [...prev.avizIds, ...res.avizIds],
        detailsFailed: [...prev.detailsFailed, ...res.detailsFailed],
        gcode: res.gcode,
        nextRnpmPage: res.nextRnpmPage,
      } : null);
      setSavedRefreshKey((k) => k + 1);
    } catch (e) {
      if (!isAbort(e) && !ctl.signal.aborted) setError(e instanceof Error ? e.message : "Eroare necunoscuta");
    } finally {
      if (abortRef.current === ctl) abortRef.current = null;
      setLoading(false);
      setPhase("");
    }
  };

  const handleStop = () => {
    stoppedRef.current = true;
    abortRef.current?.abort();
    setLoading(false);
    setPhase("");
  };

  useEffect(() => {
    if (!pendingSearch) return;
    const { type, params } = pendingSearch;
    consumePendingSearch();
    setTab("search");
    setLastType(type);
    setLastParams(params);
    setFormResetKey((k) => k + 1);
    void runSearch(type, params);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSearch]);

  const openDetailByAvizId = (id: number | null) => {
    if (id != null) setDetailAvizId(id);
    else setError("Detaliile nu sunt disponibile pentru acest aviz (UUID expirat in timpul cautarii). Refa cautarea pentru a reincarca detaliile.");
  };

  const tabs: { id: Tab; label: string; icon: typeof FileLock2 }[] = [
    { id: "search", label: "Cautare", icon: FileLock2 },
    { id: "bulk", label: "Bulk", icon: ListChecks },
    { id: "saved", label: "Baza locala", icon: Database },
  ];

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
              onAfterDeleteAll={() => setSavedRefreshKey((k) => k + 1)}
            />
          </div>
        )}
      </div>

      {tab === "search" && (
        <div className="space-y-4">
          <RnpmSearchForm
            key={formResetKey}
            loading={loading}
            loadingPhase={phase}
            onSubmit={(type, params) => runSearch(type, params)}
            onStop={handleStop}
            onReset={() => { setResult(null); setError(null); setLastParams({}); }}
            initialType={lastType}
            initialParams={lastParams}
            extraActions={result && result.nextRnpmPage != null ? (
              <Button type="button" disabled={loading} onClick={loadNextBatch} className="font-normal h-8 px-3 text-xs">
                Incarca mai multe ({result.documents.length} din {result.total})
              </Button>
            ) : null}
          />
          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}
          <RnpmResultsTable
            result={result}
            loading={loading}
            onNeedMore={loadNextBatch}
            onOpenDetail={(_doc, avizId) => openDetailByAvizId(avizId)}
            searchType={lastType}
            dateStart={lastParams.perioadaStart}
            dateEnd={lastParams.perioadaFinal}
            elapsedMs={elapsedMs}
          />
        </div>
      )}

      {tab === "bulk" && (
        <RnpmBulkSearch captchaKey={captchaKey} captchaProvider={captchaProvider} fallback2CaptchaKey={fallback2CaptchaKey} captchaMode={captchaMode} onConfigureKey={onConfigureKey} />
      )}

      {tab === "saved" && (
        <RnpmSavedData
          onOpenDetail={setDetailAvizId}
          refreshKey={savedRefreshKey}
          onChanged={() => setSavedStatsKey((k) => k + 1)}
        />
      )}

      <RnpmDetailModal avizId={detailAvizId} onClose={() => setDetailAvizId(null)} />
    </div>
  );
}

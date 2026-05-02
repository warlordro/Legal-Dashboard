import { useCallback, useEffect, useRef, useState } from "react";
import { Scale, ScrollText, BookOpen } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDialog } from "@/hooks/useDialog";
import type { Dosar, SearchHistoryEntry, SearchParams } from "@/types";
import type { RnpmSearchHistoryEntry } from "@/types/rnpm";
import { LastDosareCard, LastRnpmCard } from "./dashboard-summary-cards";
import { ChangelogDialog, ManualDialog } from "./dashboard-modals";
import { KpiStrip } from "@/components/dashboard/KpiStrip";
import { QuickActions } from "@/components/dashboard/QuickActions";
import { Charts } from "@/components/dashboard/Charts";
import { dashboardApi, MonitoringApiError, type DashboardSummary } from "@/lib/api";

// PR-A (v2.7.0) — refresh-uim KPI strip-ul la fiecare 30s. SSE delta pe
// alerts.unseen ramane pentru PR-B (cand prop-ul `alertsStreamVersion`
// din App.tsx va fi plumb-uit pana aici); polling-ul curent surprinde
// orice alert nou in maximum 30s, ceea ce e suficient pentru MVP.
const SUMMARY_POLL_MS = 30_000;

const APP_VERSION = `v${__APP_VERSION__}`;

interface DosareState {
  allDosare: Dosar[];
  categorii: string[];
  stadii: string[];
  searched: boolean;
  error: string | null;
  searchedName?: string;
  lastSearchParams?: SearchParams;
}

interface DashboardProps {
  dosareState: DosareState;
  rnpmHistory: RnpmSearchHistoryEntry[];
  history: SearchHistoryEntry[];
  onHistoryClick: (type: "dosare" | "termene", params: SearchParams) => void;
}

function getUniqueCategories(dosare: Dosar[]): string[] {
  const cats = new Set<string>();
  for (const d of dosare) {
    if (d.categorieCaz) cats.add(d.categorieCaz);
  }
  return Array.from(cats);
}

function getUniqueInstitutii(dosare: Dosar[]): number {
  const set = new Set<string>();
  for (const d of dosare) {
    if (d.institutie) set.add(d.institutie);
  }
  return set.size;
}

export default function Dashboard({ dosareState, rnpmHistory, history, onHistoryClick }: DashboardProps) {
  const navigate = useNavigate();
  const [showChangelog, setShowChangelog] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [isDownloadingManual, setIsDownloadingManual] = useState(false);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  // AbortController coalesces overlapping requests when polling fires while
  // a previous request is still in flight (slow network, sleep/wake, etc.).
  const summaryAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchSummary = async () => {
      summaryAbortRef.current?.abort();
      const controller = new AbortController();
      summaryAbortRef.current = controller;
      setSummaryLoading(true);
      try {
        const data = await dashboardApi.summary(controller.signal);
        if (cancelled) return;
        setSummary(data);
        setSummaryError(null);
      } catch (err) {
        if (cancelled) return;
        if ((err as { name?: string })?.name === "AbortError") return;
        const message = err instanceof MonitoringApiError ? err.message : "Eroare necunoscuta.";
        setSummaryError(message);
      } finally {
        if (!cancelled) setSummaryLoading(false);
      }
    };
    void fetchSummary();
    const interval = window.setInterval(fetchSummary, SUMMARY_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      summaryAbortRef.current?.abort();
    };
  }, []);

  const hasDosareData = dosareState.searched && dosareState.allDosare.length > 0;
  const lastDosareEntry = history.find((e) => e.type === "dosare");
  // Live state wins; fall back to persisted history entry after restart.
  const dosareCard = hasDosareData
    ? {
        count: dosareState.allDosare.length,
        categoriesCount: getUniqueCategories(dosareState.allDosare).length,
        institutiiCount: getUniqueInstitutii(dosareState.allDosare),
        searchedName: dosareState.searchedName,
        params: dosareState.lastSearchParams ?? null,
      }
    : lastDosareEntry
      ? {
          count: lastDosareEntry.resultCount,
          categoriesCount: lastDosareEntry.meta?.categoriesCount ?? 0,
          institutiiCount: lastDosareEntry.meta?.institutiiCount ?? 0,
          searchedName: lastDosareEntry.params.numeParte,
          params: lastDosareEntry.params,
        }
      : null;
  const handleOpenDosare = () => {
    // When live data exists, just navigate — Dosare still has it in state.
    // When falling back to history, re-run the search so the user lands on filled results.
    if (!hasDosareData && dosareCard?.params) onHistoryClick("dosare", dosareCard.params);
    navigate("/dosare");
  };
  const lastRnpm = rnpmHistory[0];

  const closeChangelog = useCallback(() => setShowChangelog(false), []);
  const closeManual = useCallback(() => setShowManual(false), []);
  const changelogRef = useDialog<HTMLDivElement>(showChangelog, closeChangelog);
  const manualRef = useDialog<HTMLDivElement>(showManual, closeManual);

  const handleDownloadManualPdf = async () => {
    setIsDownloadingManual(true);
    try {
      // Dynamic import keeps jspdf/xlsx out of the initial Dashboard chunk.
      const { exportManualPDF } = await import("@/lib/export");
      await exportManualPDF();
    } finally {
      setIsDownloadingManual(false);
    }
  };

  return (
    <div className="space-y-8 p-6">
      {/* Hero */}
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg">
          <Scale className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Legal Dashboard</h1>
          <p className="mt-1 text-muted-foreground">
            Acces rapid la dosarele si termenele din instantele romanesti prin API-ul public al Ministerului Justitiei.
          </p>
        </div>
      </div>

      <KpiStrip data={summary} loading={summaryLoading} error={summaryError} />

      <QuickActions />

      {dosareCard && (
        <LastDosareCard
          count={dosareCard.count}
          categoriesCount={dosareCard.categoriesCount}
          institutiiCount={dosareCard.institutiiCount}
          searchedName={dosareCard.searchedName}
          onOpen={handleOpenDosare}
        />
      )}

      {lastRnpm && <LastRnpmCard entry={lastRnpm} />}

      {/* PR-B (v2.8.0) — Tendinte agregate. Timeline-ul a fost eliminat in
          v2.9.1: continutul "Run ok / dosar_soap" nu era util pentru utilizatori
          non-tehnici (alertele actionable au pagina dedicata /alerte). */}
      <Charts />

      {/* API Info + Version */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="pt-5">
            <h3 className="mb-3 text-sm font-semibold">Informatii API</h3>
            <div className="space-y-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-green-500" />
                <span>Web Service SOAP: <code className="text-foreground">http://portalquery.just.ro/query.asmx</code></span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-blue-500" />
                <span>Metode disponibile: <code className="text-foreground">CautareDosare</code>, <code className="text-foreground">CautareTermene</code></span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-purple-500" />
                <span>Limita rezultate: max. 1000 inregistrari per cerere</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-amber-500" />
                <span>Autentificare: nu este necesara (API public)</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <h3 className="mb-3 text-sm font-semibold">Versiune Aplicatie</h3>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Badge className="bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400 text-sm font-bold px-3 py-1">
                  {APP_VERSION}
                </Badge>
                <span className="text-xs text-muted-foreground">AI Enabled</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Modul RNPM complet (avize, creditori, debitori, bunuri, istoric), analiza AI multi-agent (Claude 4.6 / Gemini 3.x / GPT-5.4) si audit de securitate — cheile API pastrate in OS keystore, backend legat pe loopback si protectie formula injection la export.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => setShowChangelog(true)}
                >
                  <ScrollText className="h-4 w-4" />
                  Vezi Noutati
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => setShowManual(true)}
                >
                  <BookOpen className="h-4 w-4" />
                  Manual
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {showChangelog && (
        <ChangelogDialog dialogRef={changelogRef} appVersion={APP_VERSION} onClose={closeChangelog} />
      )}
      {showManual && (
        <ManualDialog
          dialogRef={manualRef}
          appVersion={APP_VERSION}
          onClose={closeManual}
          onDownloadPdf={handleDownloadManualPdf}
          isDownloading={isDownloadingManual}
        />
      )}
    </div>
  );
}

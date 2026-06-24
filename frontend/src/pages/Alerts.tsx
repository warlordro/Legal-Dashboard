import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell,
  CheckCheck,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Filter,
  Loader2,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  alertsApi,
  alertKindLabels,
  severityLabels,
  type AlertDismissBulkRequest,
  type AlertKind,
  type AlertSeverity,
  type MonitoringAlert,
} from "@/lib/alertsApi";
import { buildAlertContext, humanizeAlertTitleDates } from "@/lib/alert-context";
import { formatIsoDateTime } from "@/lib/datetime-formatters";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useFontSize } from "@/hooks/useFontSize";
import { getDosarExternalUrl } from "@/components/dosare-table-helpers";
import { AlertNoteBlock } from "@/components/alerts/AlertNoteBlock";
import { JobKindTabs, type JobKindFilter } from "@/components/monitoring/JobKindTabs";
import { TablePagination } from "@/components/table-pagination";
import { AlertsExportModal } from "@/components/AlertsExportModal";

// Tipurile rezervate pentru runner-e / configuratii care nu sunt cablate inca:
//  - dosar_relevant_now / dosar_no_longer_relevant cer filtre alert_config.stadii
//    sau .categorii setate per job, dar UI-ul de Monitorizare nu le expune, deci
//    `dosarPassesFilter` returneaza mereu true si tranzitia nu se declanseaza.
//  - aviz_changed e rezervat pentru monitoring-ul RNPM care nu are runner.
//  - dosar_disappeared e gated de alert_config.notify_on_dosar_disappeared cu
//    default false, iar UI-ul nu expune toggle-ul, deci ramane inert.
// Le ascundem din dropdown-ul de filtrare ca sa nu sugeram optiuni inerte;
// alertKindLabels ramane neschimbat ca eventualele alerte istorice cu aceste
// kind-uri sa-si pastreze label-ul in badge.
const HIDDEN_KIND_FILTERS: ReadonlySet<AlertKind> = new Set([
  "dosar_relevant_now",
  "dosar_no_longer_relevant",
  "aviz_changed",
  "dosar_disappeared",
]);

const kindOptions: Array<{ value: AlertKind | "all"; label: string }> = [
  { value: "all", label: "Toate tipurile" },
  ...Object.entries(alertKindLabels)
    .filter(([value]) => !HIDDEN_KIND_FILTERS.has(value as AlertKind))
    .map(([value, label]) => ({
      value: value as AlertKind,
      label,
    })),
];

const severityOptions: Array<{ value: AlertSeverity | "all"; label: string }> = [
  { value: "all", label: "Toate severitatile" },
  { value: "critical", label: "Critic" },
  { value: "warning", label: "Atentie" },
  { value: "info", label: "Info" },
];

// Convert a YYYY-MM-DD date input (interpreted in the user's local timezone)
// to an ISO string. `endOfDay=true` returns 23:59:59.999 local time, otherwise
// 00:00:00.000 local. Using the multi-arg Date constructor keeps the wall-clock
// boundary in local time, so a UTC+3 user filtering "30 Apr" actually queries
// the full local-day window instead of being silently shifted into UTC.
function localDateInputToIso(value: string, endOfDay: boolean): string | undefined {
  if (!value) return undefined;
  const [yearStr, monthStr, dayStr] = value.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return undefined;
  const d = endOfDay ? new Date(year, month - 1, day, 23, 59, 59, 999) : new Date(year, month - 1, day, 0, 0, 0, 0);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

function severityVariant(severity: AlertSeverity): "default" | "warning" | "destructive" {
  if (severity === "critical") return "destructive";
  if (severity === "warning") return "warning";
  return "default";
}

export default function Alerts({
  streamVersion,
  onAlertsChanged,
  onOpenDosar,
}: {
  streamVersion: number;
  onAlertsChanged?: () => void;
  onOpenDosar?: (numarDosar: string, source?: "portaljust" | "iccj") => void;
}) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<MonitoringAlert[]>([]);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState(0);
  const [kind, setKind] = useState<AlertKind | "all">("all");
  const [jobKind, setJobKind] = useState<JobKindFilter>("all");
  const [searchInput, setSearchInput] = useState("");
  // page reset is wired into searchInput's onChange (event-handler batching),
  // not into the debounce settle callback — the setTimeout boundary in
  // useDebouncedValue doesn't reliably batch setDebounced + setPage in React
  // 18, which produced an extra fetch with the stale page. The fetch still
  // fires only after debounce settles; only the page indicator moves eagerly.
  // `flushQuery("")` short-circuits the 300ms wait on Reset so the next fetch
  // doesn't run with a stale `q` for one settle window.
  const [debouncedQuery, flushQuery] = useDebouncedValue(searchInput.trim(), 300);
  const [severity, setSeverity] = useState<AlertSeverity | "all">("all");
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [includeDismissed, setIncludeDismissed] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // v2.13.0 — selectie multipla pentru export. Set ca sa fie O(1) la
  // toggle si select-all, si pentru ca ordinea nu conteaza la backend.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [exportModalOpen, setExportModalOpen] = useState(false);
  // v2.14.0 — confirmare bulk dismiss. `pending` tine modul + count-ul afisat in
  // modal; cand devine null, modalul se inchide. Busy-ul ramane true pe tot
  // timpul cererii ca user-ul sa nu poata sa apese de doua ori inchide.
  const [bulkDismissPending, setBulkDismissPending] = useState<
    { mode: "ids"; count: number } | { mode: "filters"; count: number } | null
  >(null);
  const [bulkDismissBusy, setBulkDismissBusy] = useState(false);

  // Each alert card renders one step smaller than the user's font slider.
  // Constant 2px delta keeps the visual feel "always slightly smaller" across
  // all four slider positions, and the ratio updates reactively when the user
  // moves the slider because useFontSize re-renders this component.
  const fontSize = useFontSize();
  const alertCardZoom = (fontSize.value - 3) / fontSize.value;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Abort the in-flight list() when filters change before the previous response
  // lands, otherwise an out-of-order resolution overwrites fresh state with
  // stale rows (race condition: type fast in the search box, server delays the
  // wide query, narrow query lands first, wide query overwrites).
  const listAbortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    listAbortRef.current?.abort();
    const ctrl = new AbortController();
    listAbortRef.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const result = await alertsApi.list({
        page: page + 1,
        pageSize,
        kind,
        jobKind,
        q: debouncedQuery || undefined,
        severity,
        onlyUnread,
        includeDismissed,
        from: localDateInputToIso(from, false),
        to: localDateInputToIso(to, true),
        signal: ctrl.signal,
      });
      if (ctrl.signal.aborted) return;
      setRows(result.rows);
      setTotal(result.total);
      setUnread(result.unread);
    } catch (err) {
      // Aborts surface as DOMException (name: "AbortError") in browsers and as
      // a generic Error with `name === "AbortError"` in jsdom. Either way we
      // suppress the error UI: the next load() that triggered the abort will
      // own the loading/error state.
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (err instanceof Error && err.name === "AbortError") return;
      if (ctrl.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Eroare la incarcarea alertelor.");
    } finally {
      if (listAbortRef.current === ctrl) {
        setLoading(false);
        listAbortRef.current = null;
      }
    }
  }, [debouncedQuery, from, includeDismissed, jobKind, kind, onlyUnread, page, pageSize, severity, to]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: streamVersion intentionally reloads the list after SSE notifications.
  useEffect(() => {
    load();
    return () => {
      listAbortRef.current?.abort();
      listAbortRef.current = null;
    };
  }, [load, streamVersion]);

  const markSeen = async (alert: MonitoringAlert) => {
    setBusyId(alert.id);
    setError(null);
    try {
      await alertsApi.markSeen(alert.id);
      await load();
      onAlertsChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la marcarea alertei.");
    } finally {
      setBusyId(null);
    }
  };

  const markUnseen = async (alert: MonitoringAlert) => {
    setBusyId(alert.id);
    setError(null);
    try {
      await alertsApi.markUnseen(alert.id);
      await load();
      onAlertsChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la marcarea alertei ca necitita.");
    } finally {
      setBusyId(null);
    }
  };

  const dismiss = async (alert: MonitoringAlert) => {
    setBusyId(alert.id);
    setError(null);
    try {
      await alertsApi.dismiss(alert.id);
      await load();
      onAlertsChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la inchiderea alertei.");
    } finally {
      setBusyId(null);
    }
  };

  const markVisibleSeen = async () => {
    const unreadRows = rows.filter((row) => !row.read_at && !row.dismissed_at);
    if (unreadRows.length === 0) return;
    const ids = unreadRows.map((row) => row.id);
    setLoading(true);
    setError(null);
    try {
      // Prefer the bulk endpoint; fall back to per-id PATCH via Promise.allSettled
      // if the backend hasn't wired the bulk route yet.
      let usedBulk = false;
      try {
        await alertsApi.markAlertsSeen(ids);
        usedBulk = true;
      } catch (bulkErr) {
        console.warn("[alerts] bulk seen failed, falling back to per-id", bulkErr);
      }
      if (!usedBulk) {
        const results = await Promise.allSettled(ids.map((id) => alertsApi.markSeen(id)));
        for (const r of results) {
          if (r.status === "rejected") {
            console.warn("[alerts] mark seen failed for one alert", r.reason);
          }
        }
      }
      await load();
      onAlertsChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la marcarea alertelor.");
    } finally {
      setLoading(false);
    }
  };

  // v2.14.0 — bulk dismiss flow.
  //
  // Doua intrari distincte la nivel UI:
  //   - "Inchide selectia" (cand selectedIds.size > 0) → mode "ids"
  //   - "Inchide toate cele filtrate" (fara selectie) → mode "filters"
  // Ambele caz trec prin acelasi handler `confirmBulkDismiss` ca sa nu
  // dublam logica. Confirmarea modala arata count-ul real (selectedIds.size
  // sau filteredTotal) ca user-ul sa stie ce sterge inainte sa apese.
  //
  // `Inchide toate` ramane DEZACTIVAT cand `includeDismissed=true` — nu inchidem
  // alerte deja inchise. Aceeasi regula in backend (selectAlertIdsByFilters
  // exclude `dismissed_at IS NOT NULL`), dar UI-ul previne click-ul ca user-ul
  // sa nu se mire ca apare 0 randuri inchise.
  const performBulkDismiss = async (payload: AlertDismissBulkRequest) => {
    setBulkDismissBusy(true);
    setError(null);
    try {
      const result = await alertsApi.dismissBulk(payload);
      // Daca user-ul a inchis alerte din selectie, golim selectia ca sa nu
      // ramana checkbox-uri orfane in pagina urmatoare.
      if (payload.mode === "ids") {
        setSelectedIds(new Set());
      }
      setBulkDismissPending(null);
      await load();
      onAlertsChanged?.();
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la inchiderea alertelor.");
      throw err;
    } finally {
      setBulkDismissBusy(false);
    }
  };

  const requestBulkDismissSelected = () => {
    if (selectedIds.size === 0) return;
    setBulkDismissPending({ mode: "ids", count: selectedIds.size });
  };

  const requestBulkDismissFiltered = () => {
    if (includeDismissed) return; // guard UI-side; backend nu accepta oricum.
    if (total === 0) return;
    setBulkDismissPending({ mode: "filters", count: total });
  };

  const confirmBulkDismiss = async () => {
    const pending = bulkDismissPending;
    if (!pending) return;
    if (pending.mode === "ids") {
      const ids = Array.from(selectedIds);
      if (ids.length === 0) {
        setBulkDismissPending(null);
        return;
      }
      try {
        await performBulkDismiss({ mode: "ids", ids });
      } catch {
        // Eroarea e deja in setError; lasam modalul deschis ca user-ul
        // sa vada mesajul. Inchiderea modala se poate face manual.
      }
      return;
    }
    // mode === "filters"
    try {
      await performBulkDismiss({
        mode: "filters",
        filters: {
          jobKind: jobKind === "all" ? undefined : jobKind,
          q: debouncedQuery || undefined,
          kind: kind === "all" ? undefined : kind,
          severity: severity === "all" ? undefined : severity,
          onlyUnread: onlyUnread || undefined,
          from: localDateInputToIso(from, false),
          to: localDateInputToIso(to, true),
        },
      });
    } catch {
      // idem.
    }
  };

  const visibleIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someVisibleSelected = !allVisibleSelected && visibleIds.some((id) => selectedIds.has(id));

  const toggleAlertSelected = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAllVisible = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (visibleIds.every((id) => next.has(id))) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  }, [visibleIds]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const exportFilters = useMemo(
    () => ({
      jobKind: jobKind === "all" ? undefined : jobKind,
      q: debouncedQuery || undefined,
      kind: kind === "all" ? undefined : kind,
      severity: severity === "all" ? undefined : severity,
      onlyUnread: onlyUnread || undefined,
      includeDismissed: includeDismissed || undefined,
      from: localDateInputToIso(from, false),
      to: localDateInputToIso(to, true),
    }),
    [debouncedQuery, from, includeDismissed, jobKind, kind, onlyUnread, severity, to]
  );

  const filteredSummary = useMemo(() => {
    const parts = [`${total} total`];
    if (unread > 0) parts.push(`${unread} necitite`);
    if (jobKind === "dosar_soap") parts.push("Dosare");
    if (jobKind === "name_soap") parts.push("Nume");
    if (debouncedQuery) parts.push(`cautare: ${debouncedQuery}`);
    if (onlyUnread) parts.push("doar necitite");
    if (includeDismissed) parts.push("include inchise");
    return parts.join(" · ");
  }, [debouncedQuery, includeDismissed, jobKind, onlyUnread, total, unread]);

  return (
    <div className="min-h-full bg-background p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Bell className="h-6 w-6 text-primary" />
            Alerte
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{filteredSummary}</p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Filter className="h-4 w-4" />
              Filtre
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <JobKindTabs
                value={jobKind}
                onChange={(k) => {
                  setJobKind(k);
                  setPage(0);
                }}
                ariaLabel="Filtreaza alertele dupa tipul jobului"
              />
              <div className="relative min-w-[260px] max-w-md flex-1">
                <Input
                  type="text"
                  value={searchInput}
                  onChange={(e) => {
                    setSearchInput(e.target.value);
                    setPage(0);
                  }}
                  placeholder="Cauta dupa nume sau numar dosar..."
                  className="pr-8"
                  aria-label="Cautare in alerte"
                />
                {searchInput && (
                  <button
                    type="button"
                    onClick={() => {
                      flushQuery("");
                      setSearchInput("");
                      setPage(0);
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                    aria-label="Sterge cautarea"
                    title="Sterge cautarea"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-6">
              <Select
                value={kind}
                onValueChange={(v) => {
                  setKind(v as AlertKind | "all");
                  setPage(0);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Tip" />
                </SelectTrigger>
                <SelectContent>
                  {kindOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={severity}
                onValueChange={(v) => {
                  setSeverity(v as AlertSeverity | "all");
                  setPage(0);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Severitate" />
                </SelectTrigger>
                <SelectContent>
                  {severityOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input
                type="date"
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value);
                  setPage(0);
                }}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
              <input
                type="date"
                value={to}
                onChange={(event) => {
                  setTo(event.target.value);
                  setPage(0);
                }}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
              <label className="flex h-9 items-center gap-2 rounded-md border border-input px-3 text-sm">
                <input
                  type="checkbox"
                  checked={onlyUnread}
                  onChange={(event) => {
                    setOnlyUnread(event.target.checked);
                    setPage(0);
                  }}
                />
                Necitite
              </label>
              <label className="flex h-9 items-center gap-2 rounded-md border border-input px-3 text-sm">
                <input
                  type="checkbox"
                  checked={includeDismissed}
                  onChange={(event) => {
                    setIncludeDismissed(event.target.checked);
                    setPage(0);
                  }}
                />
                Inchise
              </label>
            </div>
          </CardContent>
        </Card>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            {rows.length > 0 ? (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someVisibleSelected;
                  }}
                  onChange={toggleSelectAllVisible}
                  aria-label="Selecteaza toate alertele de pe pagina"
                />
                <span className="text-foreground">
                  Selecteaza pagina
                  <span className="ml-1 text-muted-foreground">({rows.length})</span>
                </span>
              </label>
            ) : (
              <span className="text-muted-foreground">Nicio alerta de selectat</span>
            )}
            {selectedIds.size > 0 && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="text-foreground">
                  {selectedIds.size} {selectedIds.size === 1 ? "alerta selectata" : "alerte selectate"}
                </span>
                <button type="button" onClick={clearSelection} className="text-xs text-primary hover:underline">
                  Deselecteaza tot
                </button>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={load} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              Refresh
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setExportModalOpen(true)}
              disabled={loading || (total === 0 && selectedIds.size === 0)}
              title="Exporta alerte in Excel sau PDF (cu link-uri spre dosare)"
            >
              <Download className="h-4 w-4" />
              Export
              {selectedIds.size > 0 && (
                <span className="ml-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                  {selectedIds.size}
                </span>
              )}
            </Button>
            <Button
              size="sm"
              onClick={markVisibleSeen}
              disabled={loading || rows.length === 0 || rows.every((row) => row.read_at || row.dismissed_at)}
            >
              <CheckCheck className="h-4 w-4" />
              Marcheaza pagina
            </Button>
            {selectedIds.size > 0 ? (
              <Button
                size="sm"
                onClick={requestBulkDismissSelected}
                disabled={bulkDismissBusy || loading}
                title={`Inchide cele ${selectedIds.size} alerte selectate`}
              >
                <Trash2 className="h-4 w-4" />
                Inchide selectia
                <span className="ml-1 rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] font-semibold">
                  {selectedIds.size}
                </span>
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={requestBulkDismissFiltered}
                disabled={bulkDismissBusy || loading || total === 0 || includeDismissed}
                title={
                  includeDismissed
                    ? "Dezactiveaza filtrul 'Inchise' pentru a folosi aceasta optiune"
                    : `Inchide toate cele ${total} alerte care satisfac filtrele active`
                }
              >
                <Trash2 className="h-4 w-4" />
                Inchide toate
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-3">
          {rows.length === 0 && !loading && (
            <Card>
              <CardContent className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
                {jobKind !== "all" || debouncedQuery ? (
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <span>Niciun rezultat pentru filtrele aplicate.</span>
                    <button
                      type="button"
                      onClick={() => {
                        flushQuery("");
                        setJobKind("all");
                        setSearchInput("");
                        setPage(0);
                      }}
                      className="text-xs text-primary hover:underline"
                    >
                      Reseteaza filtrele
                    </button>
                  </div>
                ) : (
                  "Nu exista alerte pentru filtrele curente."
                )}
              </CardContent>
            </Card>
          )}

          {rows.map((alert) => {
            const unreadRow = !alert.read_at && !alert.dismissed_at;
            const ctx = buildAlertContext(alert);
            const handleOpen = () => {
              if (!ctx.numarDosar || !onOpenDosar) return;
              // Optimistically mark as read when the user opens the dossier — the
              // act of opening is implicit acknowledgement. Fire-and-forget; SSE
              // re-fetches the list on return so we don't await load() here.
              if (!alert.read_at && !alert.dismissed_at) {
                alertsApi
                  .markSeen(alert.id)
                  .then(() => onAlertsChanged?.())
                  .catch((err) => {
                    // v2.17.0 — surface marcarea esuata in banner-ul de eroare al
                    // paginii. Pre-fix doar `console.warn` — daca markSeen cadea
                    // (rate-limit, retea), user-ul revenea la pagina si vedea
                    // alerta in continuare ca necitita fara explicatie. Pastram
                    // semantica fire-and-forget (nu blocheaza navigarea).
                    console.warn("[alerts] mark seen on open failed", err);
                    setError(
                      err instanceof Error
                        ? `Marcarea alertei ca citita a esuat: ${err.message}`
                        : "Marcarea alertei ca citita a esuat."
                    );
                  });
              }
              onOpenDosar(ctx.numarDosar, ctx.source);
              navigate("/dosare");
            };
            return (
              <Card
                key={alert.id}
                className={cn(
                  "border-l-4",
                  unreadRow ? "border-l-primary" : "border-l-border",
                  alert.dismissed_at && "opacity-65"
                )}
              >
                <CardContent className="p-4" style={{ zoom: alertCardZoom }}>
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(alert.id)}
                          onChange={() => toggleAlertSelected(alert.id)}
                          aria-label={`Selecteaza alerta ${alert.title}`}
                          className="mr-1 h-4 w-4 cursor-pointer accent-primary"
                        />
                        <Badge variant={severityVariant(alert.severity)}>{severityLabels[alert.severity]}</Badge>
                        <Badge variant="outline">{alertKindLabels[alert.kind]}</Badge>
                        {unreadRow && <Badge variant="success">Nou</Badge>}
                        {alert.dismissed_at && <Badge variant="secondary">Inchisa</Badge>}
                        <span className="text-xs text-muted-foreground">{formatIsoDateTime(alert.created_at)}</span>
                      </div>
                      <h2 className="mt-2 text-base font-semibold text-foreground">
                        {humanizeAlertTitleDates(alert.title)}
                      </h2>
                      {ctx.numarDosar && (
                        <div className="mt-1 text-sm">
                          <span className="text-muted-foreground">Dosar: </span>
                          <a
                            href={getDosarExternalUrl({
                              numar: ctx.numarDosar,
                              source: ctx.source,
                              iccjId: ctx.iccjId,
                            })}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`Deschide ${ctx.numarDosar} pe ${ctx.source === "iccj" ? "scj.ro" : "portal.just.ro"}`}
                            className="inline-flex items-center gap-1 font-mono font-medium text-primary hover:text-primary/80 hover:underline"
                          >
                            {ctx.numarDosar}
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                        </div>
                      )}
                      {ctx.facts.length > 0 && (
                        <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                          {ctx.facts.map((fact) => (
                            <div key={fact.label} className="flex gap-2">
                              <dt className="shrink-0 text-muted-foreground">{fact.label}:</dt>
                              <dd className="min-w-0 break-words text-foreground">{fact.value}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                      {ctx.hotarare && (
                        <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-sm">
                          <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
                            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            {ctx.hotarare.numarDoc ? `HOTARARE NR. ${ctx.hotarare.numarDoc}` : "Hotarare"}
                          </span>
                          {ctx.hotarare.dataPronuntare && (
                            <span className="text-xs text-muted-foreground">{ctx.hotarare.dataPronuntare}</span>
                          )}
                          {ctx.hotarare.sumar && (
                            <span className="basis-full break-words text-foreground/90">
                              {ctx.hotarare.sumar.replace(/\s+/g, " ").trim()}
                            </span>
                          )}
                        </div>
                      )}
                      {ctx.fallback.length > 0 && (
                        <dl className="mt-2 grid gap-x-6 gap-y-0.5 text-xs text-muted-foreground sm:grid-cols-2">
                          {ctx.fallback.map((fact) => (
                            <div key={fact.label} className="flex gap-2">
                              <dt className="shrink-0">{fact.label}:</dt>
                              <dd className="min-w-0 break-words text-foreground/80">{fact.value}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                      <AlertNoteBlock note={alert.job_notes} />
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {ctx.numarDosar && onOpenDosar && (
                        <Button
                          variant="default"
                          size="sm"
                          onClick={handleOpen}
                          title={`Deschide ${ctx.numarDosar} in lista Dosare`}
                          className="text-[12.5px]"
                        >
                          <Eye className="h-4 w-4" />
                          Dosare
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => (alert.read_at ? markUnseen(alert) : markSeen(alert))}
                        disabled={busyId === alert.id}
                        title={alert.read_at ? "Marcheaza din nou ca necitita" : "Marcheaza ca citita"}
                        className="text-[12.5px]"
                      >
                        {alert.read_at ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        {alert.read_at ? "Necitit" : "Citit"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => dismiss(alert)}
                        disabled={busyId === alert.id || !!alert.dismissed_at}
                        className="text-[12.5px]"
                      >
                        <Trash2 className="h-4 w-4" />
                        Inchide
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {totalPages > 1 && (
          <Card>
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
          </Card>
        )}
      </div>
      <AlertsExportModal
        open={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        selectedIds={Array.from(selectedIds)}
        currentFilters={exportFilters}
        filteredTotal={total}
      />
      {bulkDismissPending && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (!bulkDismissBusy && e.target === e.currentTarget) setBulkDismissPending(null);
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="bulk-dismiss-title"
            className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
          >
            <div className="px-5 pt-5">
              <h3 id="bulk-dismiss-title" className="text-base font-semibold text-foreground">
                {bulkDismissPending.mode === "ids" ? "Inchide alertele selectate?" : "Inchide toate alertele filtrate?"}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {bulkDismissPending.mode === "ids" ? (
                  <>
                    Confirma inchiderea pentru{" "}
                    <span className="font-semibold text-foreground">{bulkDismissPending.count}</span>{" "}
                    {bulkDismissPending.count === 1 ? "alerta selectata" : "alerte selectate"}. Operatia este definitiva
                    — alertele inchise nu mai pot fi redeschise.
                  </>
                ) : (
                  <>
                    Confirma inchiderea pentru toate cele{" "}
                    <span className="font-semibold text-foreground">{bulkDismissPending.count}</span> alerte care
                    satisfac filtrele active. Operatia este definitiva — alertele inchise nu mai pot fi redeschise.
                  </>
                )}
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-border bg-muted/30 px-5 py-3 mt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBulkDismissPending(null)}
                disabled={bulkDismissBusy}
              >
                Anuleaza
              </Button>
              <Button size="sm" onClick={confirmBulkDismiss} disabled={bulkDismissBusy}>
                {bulkDismissBusy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Inchide...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4" />
                    Inchide
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

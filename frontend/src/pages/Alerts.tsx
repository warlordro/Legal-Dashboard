import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck, ExternalLink, Eye, FileText, Filter, RefreshCw, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  alertsApi,
  alertKindLabels,
  severityLabels,
  type AlertKind,
  type AlertSeverity,
  type MonitoringAlert,
} from "@/lib/alertsApi";
import { buildAlertContext } from "@/lib/alert-context";
import { formatIsoDateTime } from "@/lib/datetime-formatters";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useFontSize } from "@/hooks/useFontSize";
import { getPortalJustUrl } from "@/components/dosare-table-helpers";
import { JobKindTabs, type JobKindFilter } from "@/components/monitoring/JobKindTabs";
import { TablePagination } from "@/components/table-pagination";

const kindOptions: Array<{ value: AlertKind | "all"; label: string }> = [
  { value: "all", label: "Toate tipurile" },
  ...Object.entries(alertKindLabels).map(([value, label]) => ({
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
  const d = endOfDay
    ? new Date(year, month - 1, day, 23, 59, 59, 999)
    : new Date(year, month - 1, day, 0, 0, 0, 0);
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
  onOpenDosar?: (numarDosar: string) => void;
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
        const results = await Promise.allSettled(
          ids.map((id) => alertsApi.markSeen(id)),
        );
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <Bell className="h-6 w-6 text-primary" />
              Alerte
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{filteredSummary}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={load} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              Refresh
            </Button>
            <Button onClick={markVisibleSeen} disabled={loading || rows.every((row) => row.read_at || row.dismissed_at)}>
              <CheckCheck className="h-4 w-4" />
              Marcheaza pagina
            </Button>
          </div>
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
              <select
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value as AlertKind | "all");
                  setPage(0);
                }}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                {kindOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <select
                value={severity}
                onChange={(event) => {
                  setSeverity(event.target.value as AlertSeverity | "all");
                  setPage(0);
                }}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                {severityOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
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
              onOpenDosar(ctx.numarDosar);
              navigate("/dosare");
            };
            return (
              <Card
                key={alert.id}
                className={cn(
                  "border-l-4",
                  unreadRow ? "border-l-primary" : "border-l-border",
                  alert.dismissed_at && "opacity-65",
                )}
              >
                <CardContent className="p-4" style={{ zoom: alertCardZoom }}>
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={severityVariant(alert.severity)}>{severityLabels[alert.severity]}</Badge>
                        <Badge variant="outline">{alertKindLabels[alert.kind]}</Badge>
                        {unreadRow && <Badge variant="success">Nou</Badge>}
                        {alert.dismissed_at && <Badge variant="secondary">Inchisa</Badge>}
                        <span className="text-xs text-muted-foreground">{formatIsoDateTime(alert.created_at)}</span>
                      </div>
                      <h2 className="mt-2 text-base font-semibold text-foreground">{alert.title}</h2>
                      {ctx.numarDosar && (
                        <div className="mt-1 text-sm">
                          <span className="text-muted-foreground">Dosar: </span>
                          <a
                            href={getPortalJustUrl(ctx.numarDosar)}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`Deschide ${ctx.numarDosar} pe portal.just.ro`}
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
                            {ctx.hotarare.numarDoc
                              ? `HOTARARE NR. ${ctx.hotarare.numarDoc}`
                              : "Hotarare"}
                          </span>
                          {ctx.hotarare.dataPronuntare && (
                            <span className="text-xs text-muted-foreground">
                              {ctx.hotarare.dataPronuntare}
                            </span>
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
                        onClick={() => markSeen(alert)}
                        disabled={busyId === alert.id || !!alert.read_at}
                        className="text-[12.5px]"
                      >
                        <Eye className="h-4 w-4" />
                        Citit
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
              onPageSizeChange={(size) => { setPageSize(size); setPage(0); }}
              disabled={loading}
            />
          </Card>
        )}
      </div>
    </div>
  );
}

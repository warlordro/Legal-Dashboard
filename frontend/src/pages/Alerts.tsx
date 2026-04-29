import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, CheckCheck, Eye, Filter, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  alertsApi,
  alertKindLabels,
  severityLabels,
  type AlertKind,
  type AlertSeverity,
  type MonitoringAlert,
} from "@/lib/alertsApi";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;

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

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ro-RO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parseDetails(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { value: parsed };
  } catch {
    return { value: raw };
  }
}

function detailPreview(alert: MonitoringAlert): string {
  const detail = parseDetails(alert.detail_json);
  const candidates = [
    detail.numar,
    detail.numar_dosar,
    detail.dosar,
    detail.name_normalized,
    detail.data,
    detail.error,
    detail.message,
  ].filter((v) => typeof v === "string" && v.trim().length > 0) as string[];
  if (candidates.length > 0) return candidates.slice(0, 3).join(" · ");
  const keys = Object.keys(detail);
  if (keys.length === 0) return "Fara detalii suplimentare";
  return keys.slice(0, 4).join(" · ");
}

function severityVariant(severity: AlertSeverity): "default" | "warning" | "destructive" {
  if (severity === "critical") return "destructive";
  if (severity === "warning") return "warning";
  return "default";
}

export default function Alerts({
  streamVersion,
  onAlertsChanged,
}: {
  streamVersion: number;
  onAlertsChanged?: () => void;
}) {
  const [rows, setRows] = useState<MonitoringAlert[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState(0);
  const [kind, setKind] = useState<AlertKind | "all">("all");
  const [severity, setSeverity] = useState<AlertSeverity | "all">("all");
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [includeDismissed, setIncludeDismissed] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await alertsApi.list({
        page,
        pageSize: PAGE_SIZE,
        kind,
        severity,
        onlyUnread,
        includeDismissed,
        from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
        to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
      });
      setRows(result.rows);
      setTotal(result.total);
      setUnread(result.unread);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la incarcarea alertelor.");
    } finally {
      setLoading(false);
    }
  }, [from, includeDismissed, kind, onlyUnread, page, severity, to]);

  useEffect(() => {
    load();
  }, [load, streamVersion]);

  useEffect(() => {
    setPage(1);
  }, [from, includeDismissed, kind, onlyUnread, severity, to]);

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
    setLoading(true);
    setError(null);
    try {
      for (const alert of unreadRows) {
        await alertsApi.markSeen(alert.id);
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
    if (onlyUnread) parts.push("doar necitite");
    if (includeDismissed) parts.push("include inchise");
    return parts.join(" · ");
  }, [includeDismissed, onlyUnread, total, unread]);

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
            <div className="grid gap-3 md:grid-cols-6">
              <select
                value={kind}
                onChange={(event) => setKind(event.target.value as AlertKind | "all")}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                {kindOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <select
                value={severity}
                onChange={(event) => setSeverity(event.target.value as AlertSeverity | "all")}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                {severityOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <input
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
              <input
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
              <label className="flex h-9 items-center gap-2 rounded-md border border-input px-3 text-sm">
                <input
                  type="checkbox"
                  checked={onlyUnread}
                  onChange={(event) => setOnlyUnread(event.target.checked)}
                />
                Necitite
              </label>
              <label className="flex h-9 items-center gap-2 rounded-md border border-input px-3 text-sm">
                <input
                  type="checkbox"
                  checked={includeDismissed}
                  onChange={(event) => setIncludeDismissed(event.target.checked)}
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
                Nu exista alerte pentru filtrele curente.
              </CardContent>
            </Card>
          )}

          {rows.map((alert) => {
            const unreadRow = !alert.read_at && !alert.dismissed_at;
            return (
              <Card
                key={alert.id}
                className={cn(
                  "border-l-4",
                  unreadRow ? "border-l-primary" : "border-l-border",
                  alert.dismissed_at && "opacity-65",
                )}
              >
                <CardContent className="p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={severityVariant(alert.severity)}>{severityLabels[alert.severity]}</Badge>
                        <Badge variant="outline">{alertKindLabels[alert.kind]}</Badge>
                        {unreadRow && <Badge variant="success">Nou</Badge>}
                        {alert.dismissed_at && <Badge variant="secondary">Inchisa</Badge>}
                        <span className="text-xs text-muted-foreground">{formatDateTime(alert.created_at)}</span>
                      </div>
                      <h2 className="mt-2 text-base font-semibold text-foreground">{alert.title}</h2>
                      <p className="mt-1 break-words text-sm text-muted-foreground">{detailPreview(alert)}</p>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>Job #{alert.job_id}</span>
                        {alert.run_id && <span>Run #{alert.run_id}</span>}
                        <span>Dedup: {alert.dedup_key}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => markSeen(alert)}
                        disabled={busyId === alert.id || !!alert.read_at}
                      >
                        <Eye className="h-4 w-4" />
                        Citit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => dismiss(alert)}
                        disabled={busyId === alert.id || !!alert.dismissed_at}
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

        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
          >
            Inapoi
          </Button>
          <span className="text-sm text-muted-foreground">
            Pagina {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
          >
            Inainte
          </Button>
        </div>
      </div>
    </div>
  );
}

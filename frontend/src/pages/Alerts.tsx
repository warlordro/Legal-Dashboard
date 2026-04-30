import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck, ExternalLink, Eye, FileText, Filter, RefreshCw, Trash2 } from "lucide-react";
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
import { useFontSize } from "@/hooks/useFontSize";
import {
  formatInstitutie,
  getPortalJustUrl,
  getStadiuBadgeColor,
} from "@/components/dosare-table-helpers";
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

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function formatSedintaDate(value: unknown): string | undefined {
  const raw = asString(value);
  if (!raw) return undefined;
  // Backend may serialize as "2026-04-30", "2026-04-30T00:00:00",
  // or full ISO with timezone. We only show the day part — time is in `ora`.
  const isoDay = raw.split("T")[0];
  const m = isoDay?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const [, y, mo, d] = m;
    return `${d}.${mo}.${y}`;
  }
  return raw;
}

function getNested(detail: Record<string, unknown>, path: string[]): unknown {
  let cur: unknown = detail;
  for (const key of path) {
    if (cur && typeof cur === "object" && !Array.isArray(cur)) {
      cur = (cur as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return cur;
}

interface AlertFact {
  label: string;
  // ReactNode lets us mix plain strings with styled chunks (Stadiu badge,
  // structured Data sedintei + Ora rendering). The dd renderer handles both
  // shapes — strings inherit the row's text-foreground color, JSX brings its
  // own classes.
  value: ReactNode;
}

interface AlertContext {
  numarDosar?: string;
  instanta?: string;
  nameNormalized?: string;
  hotarare?: { numarDoc?: string; dataPronuntare?: string; sumar?: string };
  facts: AlertFact[];
  fallback: Array<{ label: string; value: string }>;
}

function humanizeKey(key: string): string {
  // snake_case / camelCase → Capitalized words. Cheap heuristic for the
  // fallback "Detalii suplimentare" rows where we don't know the field
  // semantically but still want a readable label.
  const spaced = key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function stringifyFallbackValue(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return value.trim().length > 0 ? value.trim() : undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const json = JSON.stringify(value);
    if (!json || json === "{}" || json === "[]" || json === "null") return undefined;
    return json.length > 200 ? `${json.slice(0, 197)}…` : json;
  } catch {
    return undefined;
  }
}

function buildAlertContext(alert: MonitoringAlert): AlertContext {
  const detail = parseDetails(alert.detail_json);
  // v2.6.2 — fall back to the joined job target_json for alerts that pre-date
  // runner-side enrichment. The runner injects numar_dosar / instanta /
  // name_normalized into detail at write time for new alerts; for old ones the
  // job's target_json is the only place the dossier number lives.
  let target: Record<string, unknown> = {};
  if (alert.job_target_json) {
    try {
      const parsed = JSON.parse(alert.job_target_json) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        target = parsed as Record<string, unknown>;
      }
    } catch { /* invalid JSON in target_json — ignore */ }
  }

  const numarDosar =
    asString(detail.numar_dosar) ??
    asString(detail.numar) ??
    asString(detail.dosar) ??
    asString(target.numar_dosar) ??
    asString(target.numar);
  const instanta = asString(detail.instanta) ?? asString(target.instanta);
  const nameNormalized =
    asString(detail.name_normalized) ?? asString(target.name_normalized);

  const facts: AlertFact[] = [];
  const push = (label: string, value: ReactNode | undefined) => {
    if (value === undefined || value === null) return;
    if (typeof value === "string" && value.trim().length === 0) return;
    facts.push({ label, value });
  };

  // termen_changed: detail = { from: {data,ora,complet}, to: {data,ora,complet} }
  const fromData = formatSedintaDate(getNested(detail, ["from", "data"]));
  const toData = formatSedintaDate(getNested(detail, ["to", "data"]));
  if (fromData || toData) {
    const fromOra = asString(getNested(detail, ["from", "ora"]));
    const toOra = asString(getNested(detail, ["to", "ora"]));
    push("De la", [fromData, fromOra].filter(Boolean).join(" · "));
    push("La", [toData, toOra].filter(Boolean).join(" · "));
    push("Complet", asString(getNested(detail, ["to", "complet"])) ?? asString(getNested(detail, ["from", "complet"])));
  } else {
    // Date + ora rendered as one cohesive value so both share text-foreground
    // (no muted "Ora" suffix). The 2-col grid would otherwise push the time
    // onto the next row half, breaking the visual unit.
    const sedintaData = formatSedintaDate(detail.data);
    const sedintaOra = asString(detail.ora);
    if (sedintaData || sedintaOra) {
      // "Ora" reads as a sub-label inside the value, so it shares the muted
      // color of the dt labels ("Data sedintei:", "Complet:", ...). The
      // numeric time keeps text-foreground so the eye still tracks "what" vs
      // "when" with one consistent gray-vs-black rhythm across the row.
      push(
        "Data sedintei",
        <span className="text-foreground">
          {sedintaData}
          {sedintaData && sedintaOra ? "  " : ""}
          {sedintaOra && (
            <>
              <span className="text-muted-foreground">Ora</span> {sedintaOra}
            </>
          )}
        </span>,
      );
    }
    push("Complet", asString(detail.complet));
  }

  // For solutie_aparuta the title already reads "Solutie publicata: <solutie>"
  // so the same value as a fact row would just be visual duplication. Skip
  // for that kind only — keep for any future kind that may carry detail.solutie
  // without surfacing it in the title.
  if (alert.kind !== "solutie_aparuta") {
    push("Solutie", asString(detail.solutie));
  }
  // v2.6.4 — solutie_aparuta carries the full ruling. Pull numar_document /
  // data_pronuntare / solutie_sumar out of the regular facts grid into a
  // dedicated callout block; cramming the multi-sentence ruling into a
  // 2-column key:value grid alongside Data/Ora/Complet was visually awkward.
  const numarDoc = asString(detail.numar_document);
  const dataPronuntare = formatSedintaDate(detail.data_pronuntare);
  const sumar = asString(detail.solutie_sumar);
  const hotarare = numarDoc || dataPronuntare || sumar
    ? { numarDoc, dataPronuntare, sumar }
    : undefined;

  // Stadiu rendered as a colored Badge to match Cautare Dosare styling
  // (slate / sky / indigo / orange per stadiu kind).
  const stadiuValue = asString(detail.stadiu) ?? asString(detail.stadiu_procesual);
  if (stadiuValue) {
    push(
      "Stadiu",
      <Badge variant="outline" className={cn("text-xs", getStadiuBadgeColor(stadiuValue))}>
        {stadiuValue}
      </Badge>,
    );
  }
  push("Categorie", asString(detail.categorie));

  // dosar_new (name_soap) flat detail; stadiu/categorie/instanta already handled above.
  // stadiu_changed / categorie_changed: detail = { from, to } (string values)
  if (alert.kind === "stadiu_changed" || alert.kind === "categorie_changed") {
    const from = asString(detail.from);
    const to = asString(detail.to);
    if (from || to) {
      push("Schimbare", `${from ?? "-"} → ${to ?? "-"}`);
    }
  }

  // formatInstitutie humanizes "CurteadeApelSUCEAVA" → "Curtea de Apel SUCEAVA"
  // so the alert reads like the Cautare Dosare detail card (single source of
  // truth: lib/institutii.ts lookup table). Falls back to the raw string if
  // the lookup misses, so unknown courts still show up rather than being
  // silently dropped.
  if (instanta) push("Instanta", formatInstitutie(instanta));
  if (nameNormalized) push("Nume monitorizat", nameNormalized);

  push("Mesaj", asString(detail.message));
  push("Eroare", asString(detail.error_code) ?? asString(detail.error));

  // Reserve as ultimate fallback for unknown structures. v2.6.2: render values
  // (humanized label + JSON-stringified value), not just key names — the prior
  // "Detalii suplimentare: keyA · keyB" line dropped the actual data.
  const consumed = new Set([
    "numar_dosar", "numar", "dosar", "instanta", "name_normalized",
    "data", "ora", "complet", "solutie", "stadiu", "stadiu_procesual",
    "categorie", "from", "to", "message", "error", "error_code", "observedAt",
    "solutie_sumar", "numar_document", "data_pronuntare",
  ]);
  const fallback: Array<{ label: string; value: string }> = [];
  for (const key of Object.keys(detail)) {
    if (consumed.has(key)) continue;
    const v = stringifyFallbackValue(detail[key]);
    if (v) fallback.push({ label: humanizeKey(key), value: v });
  }

  return { numarDosar, instanta, nameNormalized, hotarare, facts, fallback };
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await alertsApi.list({
        page: page + 1,
        pageSize,
        kind,
        severity,
        onlyUnread,
        includeDismissed,
        from: localDateInputToIso(from, false),
        to: localDateInputToIso(to, true),
      });
      setRows(result.rows);
      setTotal(result.total);
      setUnread(result.unread);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la incarcarea alertelor.");
    } finally {
      setLoading(false);
    }
  }, [from, includeDismissed, kind, onlyUnread, page, pageSize, severity, to]);

  useEffect(() => {
    load();
  }, [load, streamVersion]);

  useEffect(() => {
    setPage(0);
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
                        <span className="text-xs text-muted-foreground">{formatDateTime(alert.created_at)}</span>
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

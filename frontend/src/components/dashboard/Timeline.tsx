// PR-B (v2.8.0) — Timeline ops pentru pagina Dashboard.
//
// Stream descrescator de evenimente operationale combinat din 3 surse
// (alerts / runs / curated audit), paginat dupa cursor opaque (ts ISO).
// Endpoint backend: GET /api/v1/dashboard/timeline?cursor=&limit=
//
// Componenta face fetch-ul propriu (NU primeste data din parinte): nu vrem ca
// pagina Dashboard sa orchestreze toate cele trei trase (summary/timeline/
// charts) intr-un singur effect. Polling-ul KPI strip ramane separat la 30s.
//
// Click-handlers per kind (alert/run/audit) raman minimali aici — pagina
// Alerts si Audit au filtre proprii. Pentru "alert" linkam catre /alerte;
// pentru "run" si "audit" tinem deocamdata doar tooltip + detail expand.

import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Bell,
  Loader2,
  PlayCircle,
  RefreshCw,
  Shield,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  dashboardApi,
  MonitoringApiError,
  type TimelineEvent,
  type TimelineEventKind,
  type TimelineEventSeverity,
} from "@/lib/api";

const PAGE_SIZE = 30;

const KIND_META: Record<TimelineEventKind, { icon: typeof Bell; label: string }> = {
  alert: { icon: Bell, label: "Alerta" },
  run: { icon: PlayCircle, label: "Rulare" },
  audit: { icon: Shield, label: "Audit" },
};

const SEVERITY_BG: Record<TimelineEventSeverity, string> = {
  info: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  critical: "bg-red-500/10 text-red-600 dark:text-red-400",
};

const dateFmt = new Intl.DateTimeFormat("ro-RO", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function formatTs(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return dateFmt.format(d);
}

function relativeTime(ts: string, now: number): string {
  const d = new Date(ts).getTime();
  if (Number.isNaN(d)) return "";
  const diff = Math.max(0, now - d);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s in urma`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m in urma`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h in urma`;
  const days = Math.floor(h / 24);
  return `${days}z in urma`;
}

function eventSubline(ev: TimelineEvent): string | null {
  // Tease useful detail per kind without rendering the full JSON. Keeps the
  // row dense but informative; full detail panel comes later if needed.
  if (ev.kind === "run") {
    const d = ev.detail as Record<string, unknown>;
    const dur = typeof d.duration_ms === "number" ? `${Math.round(d.duration_ms / 100) / 10}s` : null;
    const created = typeof d.alerts_created === "number" ? `${d.alerts_created} alerte noi` : null;
    const errCode = typeof d.error_code === "string" ? d.error_code : null;
    const parts = [dur, created, errCode].filter((p): p is string => Boolean(p));
    return parts.length > 0 ? parts.join(" · ") : null;
  }
  if (ev.kind === "alert") {
    const d = ev.detail as Record<string, unknown>;
    const target = d.job_target as Record<string, unknown> | undefined;
    if (target) {
      if (typeof target.numar_dosar === "string" && target.numar_dosar.trim()) {
        return `Dosar: ${target.numar_dosar}`;
      }
      if (typeof target.nume === "string" && target.nume.trim()) {
        return `Nume: ${target.nume}`;
      }
    }
    return null;
  }
  if (ev.kind === "audit") {
    const d = ev.detail as Record<string, unknown>;
    const outcome = typeof d.outcome === "string" ? d.outcome : null;
    const target = typeof d.target_kind === "string" && typeof d.target_id === "string"
      ? `${d.target_kind}:${d.target_id}`
      : null;
    const parts = [outcome ? `outcome=${outcome}` : null, target].filter((p): p is string => Boolean(p));
    return parts.length > 0 ? parts.join(" · ") : null;
  }
  return null;
}

function TimelineRow({ event, now }: { event: TimelineEvent; now: number }) {
  const { icon: Icon, label } = KIND_META[event.kind];
  const subline = eventSubline(event);
  const titleLine = (
    <p className="truncate text-sm font-medium leading-tight">{event.title}</p>
  );
  const wrapped = event.kind === "alert" ? (
    <Link to="/alerte" className="block min-w-0 flex-1 hover:underline">
      {titleLine}
    </Link>
  ) : (
    <div className="min-w-0 flex-1">{titleLine}</div>
  );

  return (
    <li className="flex items-start gap-3 border-b border-border py-2 last:border-b-0">
      <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md", SEVERITY_BG[event.severity])}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          {wrapped}
          <span className="shrink-0 text-[11px] text-muted-foreground" title={formatTs(event.ts)}>
            {relativeTime(event.ts, now)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="rounded bg-muted px-1.5 py-0.5">{label}</span>
          {subline && <span className="truncate">{subline}</span>}
        </div>
      </div>
    </li>
  );
}

export function Timeline() {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `now` updates every minute so relative times re-render without a full
  // re-fetch. Coarser tick is fine — the timeline shows minutes-scale events.
  const [now, setNow] = useState(() => Date.now());
  const inflightRef = useRef<AbortController | null>(null);

  const loadInitial = useCallback(async () => {
    inflightRef.current?.abort();
    const controller = new AbortController();
    inflightRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const data = await dashboardApi.timeline({ limit: PAGE_SIZE, signal: controller.signal });
      if (controller.signal.aborted) return;
      setEvents(data.events);
      setCursor(data.nextCursor);
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      const message = err instanceof MonitoringApiError ? err.message : "Eroare necunoscuta.";
      setError(message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await dashboardApi.timeline({ cursor, limit: PAGE_SIZE });
      // Dedup defensively: same id should not appear twice across pages because
      // of the strict `<` cursor, but we guard against same-ms ties just in case.
      setEvents((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        const fresh = data.events.filter((e) => !seen.has(e.id));
        return [...prev, ...fresh];
      });
      setCursor(data.nextCursor);
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      const message = err instanceof MonitoringApiError ? err.message : "Eroare necunoscuta.";
      setError(message);
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore]);

  useEffect(() => {
    void loadInitial();
    return () => {
      inflightRef.current?.abort();
    };
  }, [loadInitial]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
        <div>
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Activitate recenta
          </CardTitle>
          <CardDescription className="text-xs">
            Alerte, rulari de monitorizare si evenimente de audit (cele mai noi primele).
          </CardDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void loadInitial()}
          disabled={loading}
          className="h-8 gap-2"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Actualizeaza
        </Button>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>Nu am putut incarca activitatea: {error}</span>
          </div>
        )}
        {loading && events.length === 0 && (
          <div className="flex min-h-32 items-center justify-center text-xs text-muted-foreground">
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            Se incarca activitatea...
          </div>
        )}
        {!loading && events.length === 0 && !error && (
          <div className="flex min-h-32 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
            Nicio activitate inregistrata inca.
          </div>
        )}
        {events.length > 0 && (
          <ul className="-mt-2">
            {events.map((event) => (
              <TimelineRow key={event.id} event={event} now={now} />
            ))}
          </ul>
        )}
        {cursor && events.length > 0 && (
          <div className="mt-3 flex justify-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="gap-2"
            >
              {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Incarca mai multe
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

import { Fragment, useEffect, useState } from "react";
import { ClipboardList, Download, RefreshCw, Filter, ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SortableTh } from "@/components/ui/sortable-th";
import { TablePagination } from "@/components/table-pagination";
import { useClientSort } from "@/hooks/useClientSort";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { admin, fetchBlobOrThrow, triggerBlobDownload, type AuditEvent } from "@/lib/api";
import { formatIsoDateTime } from "@/lib/datetime-formatters";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;

const OUTCOME_OPTIONS: ReadonlyArray<{ value: "all" | "ok" | "denied" | "error"; label: string }> = [
  { value: "all", label: "Toate rezultatele" },
  { value: "ok", label: "OK" },
  { value: "denied", label: "Refuzat" },
  { value: "error", label: "Eroare" },
];

// v2.42.0 (5.4/6.5): outcome-ul se afiseaza tradus, in badge SI in sumar.
function outcomeLabel(outcome: "ok" | "denied" | "error"): string {
  return OUTCOME_OPTIONS.find((o) => o.value === outcome)?.label ?? outcome;
}

// Convert a YYYY-MM-DD date input (interpreted in the user's local timezone)
// to an ISO string. Matches the convention used by Alerts.tsx so admins
// comparing audit windows to alert windows see the same wall-clock boundary.
function localDateInputToIso(value: string, endOfDay: boolean): string | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return undefined;
  const dt = endOfDay ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d, 0, 0, 0, 0);
  if (Number.isNaN(dt.getTime())) return undefined;
  return dt.toISOString();
}

function outcomeVariant(outcome: AuditEvent["outcome"]): "success" | "warning" | "destructive" {
  if (outcome === "ok") return "success";
  if (outcome === "denied") return "warning";
  return "destructive";
}

function detailToString(detail: unknown): string {
  if (detail === null || detail === undefined) return "{}";
  try {
    return JSON.stringify(detail, null, 2);
  } catch {
    return String(detail);
  }
}

export default function AdminAudit({ embedded = false }: { embedded?: boolean } = {}) {
  const [rows, setRows] = useState<AuditEvent[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [action, setAction] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [actorId, setActorId] = useState("");
  const [targetKind, setTargetKind] = useState("");
  const [outcome, setOutcome] = useState<"all" | "ok" | "denied" | "error">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // v2.42.0 (6.8): sortare client-side pe pagina curenta. Rezultatul se
  // sorteaza pe eticheta UMANA (OK/Refuzat/Eroare), ca ordinea sa urmeze ce
  // vede userul in badge.
  const sort = useClientSort(rows, {
    ts: (r) => r.ts,
    action: (r) => r.action,
    outcome: (r) => outcomeLabel(r.outcome),
    owner: (r) => r.ownerEmail ?? r.ownerId,
    actor: (r) => r.actorEmail ?? r.actorId,
  });

  // v2.42.0 (6.7): pattern-ul corect de filtre + fetch.
  //   - inputurile text merg prin debounce 300ms cu FLUSH expus ("Reseteaza"
  //     publica imediat "" pe toate — altfel fetch-ul pleaca cu filtrele vechi
  //     inca 300ms);
  //   - resetarea paginii se face INLINE in handlerele de input, NU intr-un
  //     efect paralel cu aceleasi deps (dubla fetch-ul si lasa raspunsuri
  //     stale sa suprascrie);
  //   - efectul de fetch are AbortController cu cleanup + guards pe
  //     then/catch/finally — un raspuns lent nu suprascrie unul proaspat;
  //   - reincarcarea manuala = refreshTick numarat in deps-ul ACELUIASI efect.
  const [debouncedAction, flushAction] = useDebouncedValue(action);
  const [debouncedOwnerId, flushOwnerId] = useDebouncedValue(ownerId);
  const [debouncedActorId, flushActorId] = useDebouncedValue(actorId);
  const [debouncedTargetKind, flushTargetKind] = useDebouncedValue(targetKind);
  const [refreshTick, setRefreshTick] = useState(0);

  const resetPageInline = () => {
    setPage(1);
    setExpanded(new Set());
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshTick este trigger explicit de reincarcare (pattern 6.7), nu e citit in corp.
  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    admin
      .listAudit({
        page,
        pageSize,
        // actionLike supports prefix/substring matching (admin.users.*); plain
        // `action` requires an exact value, which is rarely what an auditor wants.
        actionLike: debouncedAction || undefined,
        ownerId: debouncedOwnerId || undefined,
        actorId: debouncedActorId || undefined,
        targetKind: debouncedTargetKind || undefined,
        outcome: outcome === "all" ? undefined : outcome,
        since: localDateInputToIso(from, false),
        until: localDateInputToIso(to, true),
        signal: ac.signal,
      })
      .then((result) => {
        if (ac.signal.aborted) return;
        setRows(result.rows);
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Eroare la incarcarea jurnalului.");
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [
    debouncedAction,
    debouncedActorId,
    debouncedOwnerId,
    debouncedTargetKind,
    from,
    outcome,
    page,
    pageSize,
    to,
    refreshTick,
  ]);

  const onResetFilters = () => {
    setAction("");
    setOwnerId("");
    setActorId("");
    setTargetKind("");
    setOutcome("all");
    setFrom("");
    setTo("");
    // Flush: fetch-ul imediat pleaca cu filtrele goale, nu cu cele vechi.
    flushAction("");
    flushOwnerId("");
    flushActorId("");
    flushTargetKind("");
    resetPageInline();
  };

  // v2.42.0 (5.4): raportul xlsx pe intervalul filtrelor curente.
  const [exporting, setExporting] = useState(false);
  const onExport = async () => {
    setExporting(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      const since = localDateInputToIso(from, false);
      const until = localDateInputToIso(to, true);
      if (since) params.set("since", since);
      if (until) params.set("until", until);
      const qs = params.toString();
      const blob = await fetchBlobOrThrow(`/api/v1/admin/audit/export${qs ? `?${qs}` : ""}`);
      triggerBlobDownload(blob, `raport-audit-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la generarea raportului.");
    } finally {
      setExporting(false);
    }
  };

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const summary = (() => {
    const parts = [`${total} evenimente`];
    if (action) parts.push(`actiune~="${action}"`);
    if (ownerId) parts.push(`owner=${ownerId}`);
    if (actorId) parts.push(`actor=${actorId}`);
    if (targetKind) parts.push(`tinta=${targetKind}`);
    if (outcome !== "all") parts.push(`rezultat=${outcomeLabel(outcome)}`);
    return parts.join(" · ");
  })();

  return (
    <div className={cn(!embedded && "min-h-full bg-background p-6")}>
      <div className={cn("space-y-5", !embedded && "mx-auto max-w-7xl")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            {!embedded && (
              <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
                <ClipboardList className="h-6 w-6 text-primary" />
                Audit
              </h1>
            )}
            <p className={cn("text-sm text-muted-foreground", !embedded && "mt-1")}>{summary}</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={onExport}
              disabled={exporting}
              title="Genereaza raport xlsx pe intervalul din filtrele De la / Pana la (goale = toata baza; max 10000 evenimente)"
            >
              <Download className={cn("h-4 w-4", exporting && "animate-pulse")} />
              {exporting ? "Se genereaza..." : "Descarca raport"}
            </Button>
            <Button variant="outline" onClick={() => setRefreshTick((t) => t + 1)} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              Reincarca
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
            <div className="grid gap-3 md:grid-cols-4">
              <input
                type="text"
                value={action}
                onChange={(e) => {
                  setAction(e.target.value);
                  resetPageInline();
                }}
                placeholder="Actiune (ex: admin.users)"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
              <input
                type="text"
                value={ownerId}
                onChange={(e) => {
                  setOwnerId(e.target.value);
                  resetPageInline();
                }}
                placeholder="Owner ID"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
              <input
                type="text"
                value={actorId}
                onChange={(e) => {
                  setActorId(e.target.value);
                  resetPageInline();
                }}
                placeholder="Actor ID"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
              <input
                type="text"
                value={targetKind}
                onChange={(e) => {
                  setTargetKind(e.target.value);
                  resetPageInline();
                }}
                placeholder="Tip tinta (ex: user)"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
              <Select
                value={outcome}
                onValueChange={(v) => {
                  setOutcome(v as typeof outcome);
                  resetPageInline();
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Rezultat" />
                </SelectTrigger>
                <SelectContent>
                  {OUTCOME_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  resetPageInline();
                }}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                title="De la (inclusiv)"
              />
              <input
                type="date"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  resetPageInline();
                }}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                title="Pana la (inclusiv)"
              />
              <Button variant="ghost" onClick={onResetFilters} className="md:col-span-1">
                Reseteaza
              </Button>
            </div>
          </CardContent>
        </Card>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </div>
        )}

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="w-8 px-2 py-2" />
                    <SortableTh sort={sort} sortKeyName="ts" scopeNote="Sorteaza pagina curenta">
                      Cand
                    </SortableTh>
                    <SortableTh sort={sort} sortKeyName="action" scopeNote="Sorteaza pagina curenta">
                      Actiune
                    </SortableTh>
                    <SortableTh sort={sort} sortKeyName="outcome" scopeNote="Sorteaza pagina curenta">
                      Rezultat
                    </SortableTh>
                    <SortableTh sort={sort} sortKeyName="owner" scopeNote="Sorteaza pagina curenta">
                      Owner
                    </SortableTh>
                    <SortableTh sort={sort} sortKeyName="actor" scopeNote="Sorteaza pagina curenta">
                      Actor
                    </SortableTh>
                    <th className="px-3 py-2 font-semibold">Tinta</th>
                    <th className="px-3 py-2 font-semibold">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && !loading && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                        Niciun eveniment de audit pentru filtrele curente.
                      </td>
                    </tr>
                  )}
                  {sort.sorted.map((row) => {
                    const isOpen = expanded.has(row.id);
                    return (
                      <Fragment key={row.id}>
                        <tr className="border-b border-border last:border-b-0 hover:bg-muted/30">
                          <td className="px-2 py-2 align-top">
                            <button
                              type="button"
                              onClick={() => toggleExpand(row.id)}
                              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                              aria-label={isOpen ? "Ascunde detalii" : "Arata detalii"}
                            >
                              {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </button>
                          </td>
                          <td className="px-3 py-2 align-top text-xs text-muted-foreground whitespace-nowrap">
                            {formatIsoDateTime(row.ts, { seconds: true })}
                          </td>
                          <td className="px-3 py-2 align-top font-mono text-xs">{row.action}</td>
                          <td className="px-3 py-2 align-top">
                            <Badge variant={outcomeVariant(row.outcome)}>{outcomeLabel(row.outcome)}</Badge>
                          </td>
                          {/* v2.42.0 (5.4): EMAIL vizibil cu fallback pe ID / "system"
                              (evenimente de sistem fara owner); ID-ul brut in title. */}
                          <td className="px-3 py-2 align-top font-mono text-xs" title={row.ownerId ?? undefined}>
                            {row.ownerEmail ?? row.ownerId ?? "system"}
                          </td>
                          <td className="px-3 py-2 align-top font-mono text-xs" title={row.actorId ?? undefined}>
                            {row.actorEmail ?? row.actorId ?? "system"}
                          </td>
                          <td className="px-3 py-2 align-top text-xs">
                            {row.targetKind ? (
                              <span className="font-mono">
                                {row.targetKind}
                                {row.targetId ? `:${row.targetId}` : ""}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                          <td className="px-3 py-2 align-top font-mono text-xs text-muted-foreground">
                            {row.ip ?? "-"}
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="border-b border-border bg-muted/20">
                            <td colSpan={8} className="px-4 py-3">
                              <div className="grid gap-3 md:grid-cols-2">
                                <div>
                                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                    Detalii
                                  </p>
                                  <pre className="mt-1 max-h-72 overflow-auto rounded-md border border-border bg-background p-2 text-xs">
                                    {detailToString(row.detail)}
                                  </pre>
                                </div>
                                <div className="space-y-1 text-xs">
                                  <p>
                                    <span className="text-muted-foreground">Event ID: </span>
                                    <span className="font-mono">{row.id}</span>
                                  </p>
                                  {row.userAgent && (
                                    <p>
                                      <span className="text-muted-foreground">User-Agent: </span>
                                      <span className="font-mono">{row.userAgent}</span>
                                    </p>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* v2.42.0 (5.4): paginare completa. Componenta e 0-based; state-ul
            paginii ramane 1-based (contractul API). Randurile expandate raman
            deschise la schimbarea paginii (id-urile nu se suprapun intre pagini). */}
        <TablePagination
          page={page - 1}
          totalPages={totalPages}
          pageSize={pageSize}
          onPageChange={(p) => setPage(p + 1)}
          onPageSizeChange={(s) => {
            setPageSize(s);
            setPage(1);
          }}
          pageSizes={[25, 50, 100, 200]}
          disabled={loading}
        />
      </div>
    </div>
  );
}

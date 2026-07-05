import { Fragment, useEffect, useState } from "react";
import { ClipboardList, RefreshCw, Filter, ChevronDown, ChevronRight, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { admin, type AuditEvent } from "@/lib/api";
import { useClientSort } from "@/hooks/useClientSort";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { SortableTh } from "@/components/ui/sortable-th";
import { TablePagination } from "@/components/table-pagination";

const SORT_SCOPE_NOTE = "Sorteaza pagina curenta";
import { formatIsoDateTime } from "@/lib/datetime-formatters";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

const OUTCOME_OPTIONS: ReadonlyArray<{ value: "all" | "ok" | "denied" | "error"; label: string }> = [
  { value: "all", label: "Toate rezultatele" },
  { value: "ok", label: "OK" },
  { value: "denied", label: "Refuzat" },
  { value: "error", label: "Eroare" },
];

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

// Acelasi vocabular ca in dropdown-ul de filtre — nu aratam token-ul intern.
function outcomeLabel(outcome: AuditEvent["outcome"]): string {
  return OUTCOME_OPTIONS.find((o) => o.value === outcome)?.label ?? outcome;
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
  // v2.42.0 (Nivel 2): sortare client-side pe pagina curenta (server-ul
  // pastreaza ordinea cronologica; sortarea nu traverseaza paginile).
  const { sorted: sortedRows, ...sort } = useClientSort(rows, {
    ts: (r) => r.ts,
    action: (r) => r.action,
    outcome: (r) => outcomeLabel(r.outcome),
    owner: (r) => r.ownerEmail ?? r.ownerId,
    actor: (r) => r.actorEmail ?? r.actorId,
  });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [actionInput, setActionInput] = useState("");
  const [ownerIdInput, setOwnerIdInput] = useState("");
  const [actorIdInput, setActorIdInput] = useState("");
  const [targetKindInput, setTargetKindInput] = useState("");
  // Filtrele text declanseaza fetch abia dupa 300ms de liniste — altfel fiecare
  // tasta apasata trimitea un request (pattern identic cu Alerts). Flush-urile
  // sunt folosite de Reseteaza ca sa nu ramana un fetch cu filtrele vechi.
  const [action, flushAction] = useDebouncedValue(actionInput.trim(), 300);
  const [ownerId, flushOwnerId] = useDebouncedValue(ownerIdInput.trim(), 300);
  const [actorId, flushActorId] = useDebouncedValue(actorIdInput.trim(), 300);
  const [targetKind, flushTargetKind] = useDebouncedValue(targetKindInput.trim(), 300);
  const [outcome, setOutcome] = useState<"all" | "ok" | "denied" | "error">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [exporting, setExporting] = useState(false);

  // v2.42.0: raport xlsx pe intervalul din filtrele De la / Pana la (ambele
  // goale = toata baza). Audit-ul e append-only — raportul e calea de a lua
  // datele; stergere manuala nu exista (retention automat 90 zile).
  const onExportReport = async () => {
    setExporting(true);
    setError(null);
    try {
      const blob = await admin.exportAuditReport({
        since: localDateInputToIso(from, false),
        until: localDateInputToIso(to, true),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `raport-audit-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la generarea raportului.");
    } finally {
      setExporting(false);
    }
  };

  // v2.42.0: paginare completa (numere de pagina + marime pagina), ca la Dosare.
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const loadAudit = async (filters: {
    page: number;
    action: string;
    ownerId: string;
    actorId: string;
    targetKind: string;
    outcome: "all" | "ok" | "denied" | "error";
    from: string;
    to: string;
  }) => {
    setLoading(true);
    setError(null);
    try {
      const result = await admin.listAudit({
        page: filters.page,
        pageSize,
        // actionLike supports prefix/substring matching (admin.users.*); plain
        // `action` requires an exact value, which is rarely what an auditor wants.
        actionLike: filters.action || undefined,
        ownerId: filters.ownerId || undefined,
        actorId: filters.actorId || undefined,
        targetKind: filters.targetKind || undefined,
        outcome: filters.outcome === "all" ? undefined : filters.outcome,
        since: localDateInputToIso(filters.from, false),
        until: localDateInputToIso(filters.to, true),
      });
      setRows(result.rows);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la incarcarea jurnalului.");
    } finally {
      setLoading(false);
    }
  };

  const load = () => loadAudit({ page, action, ownerId, actorId, targetKind, outcome, from, to });

  useEffect(() => {
    // Review-panel: fara abort, un raspuns lent (pagina veche) putea ateriza
    // dupa cel proaspat si suprascrie tabelul — same pattern ca Alerts.
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    admin
      .listAudit({
        page,
        pageSize,
        // actionLike supports prefix/substring matching (admin.users.*); plain
        // `action` requires an exact value, which is rarely what an auditor wants.
        actionLike: action || undefined,
        ownerId: ownerId || undefined,
        actorId: actorId || undefined,
        targetKind: targetKind || undefined,
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
  }, [action, actorId, from, outcome, ownerId, page, pageSize, targetKind, to]);

  // Resetarea paginii se face inline in handler-ele filtrelor (nu intr-un efect
  // pe aceleasi dependinte ca fetch-ul): efectul dubla fetch-ul cand pagina era
  // >1 — o data cu pagina veche, apoi cu pagina 1 (review-panel).
  const resetPagination = () => {
    setPage(1);
    setExpanded(new Set());
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
    <div className={embedded ? "" : "min-h-full bg-background p-6"}>
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
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={onExportReport}
              disabled={exporting}
              title="Genereaza raport xlsx pe intervalul din filtrele De la / Pana la (goale = toata baza; max 10000 evenimente)"
            >
              <Download className={cn("h-4 w-4", exporting && "animate-pulse")} />
              {exporting ? "Se genereaza..." : "Descarca raport"}
            </Button>
            <Button variant="outline" onClick={load} disabled={loading}>
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
                value={actionInput}
                onChange={(e) => {
                  setActionInput(e.target.value);
                  resetPagination();
                }}
                placeholder="Actiune (ex: admin.users)"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
              <input
                type="text"
                value={ownerIdInput}
                onChange={(e) => {
                  setOwnerIdInput(e.target.value);
                  resetPagination();
                }}
                placeholder="Owner ID"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
              <input
                type="text"
                value={actorIdInput}
                onChange={(e) => {
                  setActorIdInput(e.target.value);
                  resetPagination();
                }}
                placeholder="Actor ID"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
              <input
                type="text"
                value={targetKindInput}
                onChange={(e) => {
                  setTargetKindInput(e.target.value);
                  resetPagination();
                }}
                placeholder="Tip tinta (ex: user)"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
              <Select
                value={outcome}
                onValueChange={(v) => {
                  setOutcome(v as typeof outcome);
                  resetPagination();
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
                  resetPagination();
                }}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                title="De la (inclusiv)"
              />
              <input
                type="date"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  resetPagination();
                }}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                title="Pana la (inclusiv)"
              />
              <Button
                variant="ghost"
                onClick={() => {
                  setActionInput("");
                  setOwnerIdInput("");
                  setActorIdInput("");
                  setTargetKindInput("");
                  // Flush: fara el, fetch-ul imediat (outcome/from/to) pleca cu
                  // filtrele text VECHI inca 300ms (review-panel).
                  flushAction("");
                  flushOwnerId("");
                  flushActorId("");
                  flushTargetKind("");
                  setOutcome("all");
                  setFrom("");
                  setTo("");
                  resetPagination();
                }}
                className="md:col-span-1"
              >
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
                    <SortableTh sort={sort} sortKeyName="ts" scopeNote={SORT_SCOPE_NOTE}>
                      Cand
                    </SortableTh>
                    <SortableTh sort={sort} sortKeyName="action" scopeNote={SORT_SCOPE_NOTE}>
                      Actiune
                    </SortableTh>
                    <SortableTh sort={sort} sortKeyName="outcome" scopeNote={SORT_SCOPE_NOTE}>
                      Rezultat
                    </SortableTh>
                    <SortableTh sort={sort} sortKeyName="owner" scopeNote={SORT_SCOPE_NOTE}>
                      Owner
                    </SortableTh>
                    <SortableTh sort={sort} sortKeyName="actor" scopeNote={SORT_SCOPE_NOTE}>
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
                  {sortedRows.map((row) => {
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
                          {/* Email cand exista (lizibil); ID-ul ramane in title pentru copy/filtru. */}
                          <td className="px-3 py-2 align-top font-mono text-xs" title={row.ownerId ?? undefined}>
                            {row.ownerEmail ?? row.ownerId ?? "-"}
                          </td>
                          <td className="px-3 py-2 align-top font-mono text-xs" title={row.actorId ?? undefined}>
                            {row.actorEmail ?? row.actorId ?? "-"}
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

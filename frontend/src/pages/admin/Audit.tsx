import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardList, RefreshCw, Filter, ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { admin, type AuditEvent } from "@/lib/api";
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

function detailToString(detail: unknown): string {
  if (detail === null || detail === undefined) return "{}";
  try {
    return JSON.stringify(detail, null, 2);
  } catch {
    return String(detail);
  }
}

export default function AdminAudit() {
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

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await admin.listAudit({
        page,
        pageSize: PAGE_SIZE,
        // actionLike supports prefix/substring matching (admin.users.*); plain
        // `action` requires an exact value, which is rarely what an auditor wants.
        actionLike: action || undefined,
        ownerId: ownerId || undefined,
        actorId: actorId || undefined,
        targetKind: targetKind || undefined,
        outcome: outcome === "all" ? undefined : outcome,
        since: localDateInputToIso(from, false),
        until: localDateInputToIso(to, true),
      });
      setRows(result.rows);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la incarcarea jurnalului.");
    } finally {
      setLoading(false);
    }
  }, [action, actorId, from, outcome, ownerId, page, targetKind, to]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
    setExpanded(new Set());
  }, [action, actorId, from, outcome, ownerId, targetKind, to]);

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const summary = useMemo(() => {
    const parts = [`${total} evenimente`];
    if (action) parts.push(`actiune~="${action}"`);
    if (ownerId) parts.push(`owner=${ownerId}`);
    if (actorId) parts.push(`actor=${actorId}`);
    if (targetKind) parts.push(`tinta=${targetKind}`);
    if (outcome !== "all") parts.push(`rezultat=${outcome}`);
    return parts.join(" · ");
  }, [action, actorId, outcome, ownerId, targetKind, total]);

  return (
    <div className="min-h-full bg-background p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <ClipboardList className="h-6 w-6 text-primary" />
              Audit
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{summary}</p>
          </div>
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            Refresh
          </Button>
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
                onChange={(e) => setAction(e.target.value)}
                placeholder="Actiune (ex: admin.users)"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
              <input
                type="text"
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                placeholder="Owner ID"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
              <input
                type="text"
                value={actorId}
                onChange={(e) => setActorId(e.target.value)}
                placeholder="Actor ID"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
              <input
                type="text"
                value={targetKind}
                onChange={(e) => setTargetKind(e.target.value)}
                placeholder="Tip tinta (ex: user)"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
              <Select value={outcome} onValueChange={(v) => setOutcome(v as typeof outcome)}>
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
                onChange={(e) => setFrom(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                title="De la (inclusiv)"
              />
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                title="Pana la (inclusiv)"
              />
              <Button
                variant="ghost"
                onClick={() => {
                  setAction("");
                  setOwnerId("");
                  setActorId("");
                  setTargetKind("");
                  setOutcome("all");
                  setFrom("");
                  setTo("");
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
                    <th className="w-8 px-2 py-2"></th>
                    <th className="px-3 py-2 font-semibold">Cand</th>
                    <th className="px-3 py-2 font-semibold">Actiune</th>
                    <th className="px-3 py-2 font-semibold">Rezultat</th>
                    <th className="px-3 py-2 font-semibold">Owner</th>
                    <th className="px-3 py-2 font-semibold">Actor</th>
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
                  {rows.map((row) => {
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
                            <Badge variant={outcomeVariant(row.outcome)}>{row.outcome}</Badge>
                          </td>
                          <td className="px-3 py-2 align-top font-mono text-xs">{row.ownerId ?? "-"}</td>
                          <td className="px-3 py-2 align-top font-mono text-xs">{row.actorId ?? "-"}</td>
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

        <div className="flex items-center justify-between">
          <Button variant="outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading}>
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

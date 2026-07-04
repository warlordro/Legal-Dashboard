import { useCallback, useEffect, useState } from "react";
import { Gift, Plus, RefreshCw, Search, ShieldAlert, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { admin, type AdminUser, type QuotaGrant, type QuotaGrantWithUser } from "@/lib/api";
import { formatIsoDateTime } from "@/lib/datetime-formatters";
import { cn } from "@/lib/utils";

const MILLI = 1000;

function milliToUsd(milli: number): string {
  return (milli / MILLI).toFixed(3);
}

function parseUsdInputToMilli(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * MILLI);
}

// Converteste un input datetime-local (YYYY-MM-DDTHH:mm fara timezone) la ISO
// 8601 UTC. Backend cere offset, deci lasam Date sa-l construiasca din browser-tz.
function localDatetimeToIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function isExpired(grant: QuotaGrant): boolean {
  return Date.parse(grant.expiresAt) <= Date.now();
}

function grantState(grant: QuotaGrant): { label: string; variant: "success" | "warning" | "secondary" } {
  if (grant.revokedAt) return { label: "Revocat", variant: "secondary" };
  if (isExpired(grant)) return { label: "Expirat", variant: "warning" };
  return { label: "Activ", variant: "success" };
}

export default function AdminGrants({ embedded = false }: { embedded?: boolean } = {}) {
  const confirm = useConfirm();
  const [searchInput, setSearchInput] = useState("");
  const [candidates, setCandidates] = useState<AdminUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [grants, setGrants] = useState<QuotaGrant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feature, setFeature] = useState("ai.single");
  const [extraUsd, setExtraUsd] = useState("");
  const [expiresAtLocal, setExpiresAtLocal] = useState("");
  const [reason, setReason] = useState("");
  const [busyId, setBusyId] = useState<number | "create" | null>(null);
  // v2.41.0: vedere globala la deschidere — granturile active ale tuturor
  // userilor, fara cautarea prealabila a unui user (pandant la pagina Cote).
  const [activeGrants, setActiveGrants] = useState<QuotaGrantWithUser[]>([]);
  const [activeLoading, setActiveLoading] = useState(false);

  const loadActiveGrants = useCallback(async () => {
    setActiveLoading(true);
    try {
      const result = await admin.listActiveGrants();
      setActiveGrants(result.grants);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la incarcarea granturilor active.");
    } finally {
      setActiveLoading(false);
    }
  }, []);

  useEffect(() => {
    loadActiveGrants();
  }, [loadActiveGrants]);

  const selectFromActive = async (userId: string) => {
    try {
      const user = await admin.getUser(userId);
      onSelect(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la incarcarea utilizatorului.");
    }
  };

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchInput.trim();
    if (!q) return;
    setSearching(true);
    setError(null);
    try {
      const result = await admin.listUsers({ search: q, pageSize: 25 });
      setCandidates(result.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la cautare.");
    } finally {
      setSearching(false);
    }
  };

  const loadGrants = useCallback(async (userId: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await admin.listGrants(userId);
      setGrants(result.grants);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la incarcarea grant-urilor.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selected) loadGrants(selected.id);
    else setGrants([]);
  }, [loadGrants, selected]);

  const onSelect = (user: AdminUser) => {
    setSelected(user);
    setCandidates([]);
    setFeature("ai.single");
    setExtraUsd("");
    setExpiresAtLocal("");
    setReason("");
  };

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    const featureKey = feature.trim();
    if (!featureKey) {
      setError("Introdu un feature.");
      return;
    }
    const extraMilli = parseUsdInputToMilli(extraUsd);
    if (extraMilli === null) {
      setError("Introdu un extra valid (> 0 USD).");
      return;
    }
    const isoExpires = localDatetimeToIso(expiresAtLocal);
    if (!isoExpires) {
      setError("Introdu o data de expirare valida.");
      return;
    }
    if (Date.parse(isoExpires) <= Date.now()) {
      setError("Data de expirare trebuie sa fie in viitor.");
      return;
    }
    setBusyId("create");
    setError(null);
    try {
      await admin.createGrant(selected.id, {
        feature: featureKey,
        extraUsdMilli: extraMilli,
        expiresAt: isoExpires,
        reason: reason.trim() || null,
      });
      await loadGrants(selected.id);
      void loadActiveGrants();
      setExtraUsd("");
      setExpiresAtLocal("");
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la crearea grant-ului.");
    } finally {
      setBusyId(null);
    }
  };

  const onRevoke = async (grant: QuotaGrant) => {
    const ok = await confirm({
      title: "Revoca grant",
      message: `Revoca grant-ul de ${milliToUsd(grant.extraUsdMilli)} $ pentru "${grant.feature}"? Effective limit va scadea imediat.`,
      destructive: true,
      confirmLabel: "Revoca",
    });
    if (!ok) return;
    setBusyId(grant.id);
    setError(null);
    try {
      await admin.revokeGrant(grant.id, null);
      if (selected) await loadGrants(selected.id);
      void loadActiveGrants();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la revocarea grant-ului.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className={embedded ? "" : "min-h-full bg-background p-6"}>
      <div className={cn("space-y-5", !embedded && "mx-auto max-w-5xl")}>
        <div>
          {!embedded && (
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <Gift className="h-6 w-6 text-primary" />
              Granturi extra buget
            </h1>
          )}
          <p className={cn("text-sm text-muted-foreground", !embedded && "mt-1")}>
            One-shot extra peste limita de baza, cu expirare. Effective limit = baseLimit + suma grant-urilor active.
          </p>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-red-700/70 hover:text-red-900 dark:text-red-300/70"
            >
              ×
            </button>
          </div>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Search className="h-4 w-4" />
              Selecteaza utilizator
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <form onSubmit={search} className="flex gap-2">
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Cauta dupa email sau nume"
                className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
              />
              <Button type="submit" disabled={searching}>
                <Search className={cn("h-4 w-4", searching && "animate-pulse")} />
                Cauta
              </Button>
            </form>
            {candidates.length > 0 && (
              <ul className="divide-y divide-border rounded-md border border-border">
                {candidates.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono">{c.email}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.displayName} · {c.role} · {c.status}
                      </p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => onSelect(c)}>
                      Selecteaza
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {!selected && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                <span className="flex items-center gap-2">
                  <Gift className="h-4 w-4" />
                  Granturi active
                </span>
                <Button variant="outline" size="sm" onClick={() => loadActiveGrants()} disabled={activeLoading}>
                  <RefreshCw className={cn("h-4 w-4", activeLoading && "animate-spin")} />
                  Refresh
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {activeGrants.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  {activeLoading ? "Se incarca granturile active..." : "Nu exista granturi active."}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2 font-semibold">Utilizator</th>
                        <th className="px-3 py-2 font-semibold">Feature</th>
                        <th className="px-3 py-2 font-semibold">Extra</th>
                        <th className="px-3 py-2 font-semibold">Expira</th>
                        <th className="px-3 py-2 font-semibold">Motiv</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {activeGrants.map((g) => (
                        <tr key={g.id}>
                          <td className="px-3 py-2 align-top">
                            <p className="font-mono text-xs">{g.userEmail ?? g.userId}</p>
                            {g.userDisplayName && <p className="text-xs text-muted-foreground">{g.userDisplayName}</p>}
                          </td>
                          <td className="px-3 py-2 align-top font-mono text-xs">{g.feature}</td>
                          <td className="px-3 py-2 align-top">{milliToUsd(g.extraUsdMilli)} $</td>
                          <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                            {formatIsoDateTime(g.expiresAt)}
                          </td>
                          <td className="px-3 py-2 align-top text-xs text-muted-foreground">{g.reason ?? "—"}</td>
                          <td className="px-3 py-2 align-top text-right">
                            <Button size="sm" variant="outline" onClick={() => selectFromActive(g.userId)}>
                              Editeaza
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {selected && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                <span className="flex items-center gap-2">
                  <span className="font-mono text-sm">{selected.email}</span>
                  <Badge variant="outline">{selected.role}</Badge>
                  <Badge variant={selected.status === "active" ? "success" : "warning"}>{selected.status}</Badge>
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => loadGrants(selected.id)} disabled={loading}>
                    <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                    Refresh
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                    Schimba utilizatorul
                  </Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={onCreate} className="grid gap-3 md:grid-cols-[140px_140px_220px_1fr_auto] md:items-end">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground" htmlFor="grant-feature">
                    Feature
                  </label>
                  <select
                    id="grant-feature"
                    value={feature}
                    onChange={(e) => setFeature(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {/* Grants raman AI-only: granturile sunt denominate USD, iar guard-ul
                        captcha nu aplica extra-grant logic — o optiune captcha ar fi inerta. */}
                    <option value="ai.single">AI — analiza individuala (ai.single)</option>
                    <option value="ai.multi">AI — analiza multipla (ai.multi)</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground" htmlFor="grant-extra">
                    Extra (USD)
                  </label>
                  <input
                    id="grant-extra"
                    type="number"
                    step="0.001"
                    min="0.001"
                    value={extraUsd}
                    onChange={(e) => setExtraUsd(e.target.value)}
                    placeholder="ex: 5"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground" htmlFor="grant-expires">
                    Expira la
                  </label>
                  <input
                    id="grant-expires"
                    type="datetime-local"
                    value={expiresAtLocal}
                    onChange={(e) => setExpiresAtLocal(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground" htmlFor="grant-reason">
                    Motiv (optional)
                  </label>
                  <input
                    id="grant-reason"
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="ex: boost sprint final"
                    maxLength={500}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                </div>
                <Button type="submit" disabled={busyId !== null}>
                  <Plus className="h-4 w-4" />
                  Adauga
                </Button>
              </form>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Feature</th>
                      <th className="px-3 py-2 font-semibold">Extra</th>
                      <th className="px-3 py-2 font-semibold">Stare</th>
                      <th className="px-3 py-2 font-semibold">Expira</th>
                      <th className="px-3 py-2 font-semibold">Acordat</th>
                      <th className="px-3 py-2 font-semibold">Motiv</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {grants.length === 0 && !loading && (
                      <tr>
                        <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                          Nu exista grant-uri pentru acest utilizator.
                        </td>
                      </tr>
                    )}
                    {grants.map((g) => {
                      const state = grantState(g);
                      const revoked = g.revokedAt !== null;
                      const expired = isExpired(g);
                      return (
                        <tr key={g.id} className="border-b border-border last:border-b-0 hover:bg-muted/30">
                          <td className="px-3 py-2 align-top font-mono text-xs">{g.feature}</td>
                          <td className="px-3 py-2 align-top font-mono">${milliToUsd(g.extraUsdMilli)}</td>
                          <td className="px-3 py-2 align-top">
                            <Badge variant={state.variant}>{state.label}</Badge>
                          </td>
                          <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                            {formatIsoDateTime(g.expiresAt)}
                          </td>
                          <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                            {formatIsoDateTime(g.grantedAt)}
                            <br />
                            <span className="font-mono">{g.grantedBy}</span>
                          </td>
                          <td className="px-3 py-2 align-top text-xs">
                            {g.reason ?? <span className="text-muted-foreground">—</span>}
                            {revoked && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                Revocat {formatIsoDateTime(g.revokedAt as string)} de {g.revokedBy}
                                {g.revokedReason ? ` · ${g.revokedReason}` : ""}
                              </p>
                            )}
                          </td>
                          <td className="px-3 py-2 align-top text-right">
                            {!revoked && !expired && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => onRevoke(g)}
                                disabled={busyId === g.id}
                                className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/30"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

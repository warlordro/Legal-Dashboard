import { useCallback, useEffect, useState } from "react";
import { Gift, Plus, RefreshCw, ShieldAlert, Trash2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { UserPicker } from "@/components/UserPicker";
import { admin, type AdminUser, type GlobalQuotaGrant, type QuotaGrant } from "@/lib/api";
import { formatIsoDateTime } from "@/lib/datetime-formatters";
import { quotaFeatureLabel } from "@/lib/quotaFeatureLabels";
import { userRoleLabel, userStatusLabel } from "@/lib/userLabels";
import { cn } from "@/lib/utils";

const MILLI = 1000;

// Granturile sunt bugete AI extra — captcha nu are granturi (cap fix per user).
const GRANTABLE_FEATURES = ["ai.single", "ai.multi"] as const;

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

export default function AdminGrants() {
  const confirm = useConfirm();
  const [globalGrants, setGlobalGrants] = useState<GlobalQuotaGrant[]>([]);
  const [globalTruncated, setGlobalTruncated] = useState(false);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [grants, setGrants] = useState<QuotaGrant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feature, setFeature] = useState<string>(GRANTABLE_FEATURES[0]);
  const [extraUsd, setExtraUsd] = useState("");
  const [expiresAtLocal, setExpiresAtLocal] = useState("");
  const [reason, setReason] = useState("");
  const [busyId, setBusyId] = useState<number | "create" | null>(null);

  const loadGlobal = useCallback(async () => {
    setGlobalLoading(true);
    try {
      const result = await admin.listActiveGrants();
      setGlobalGrants(result.grants);
      setGlobalTruncated(result.truncated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la incarcarea vederii globale.");
    } finally {
      setGlobalLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGlobal();
  }, [loadGlobal]);

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

  const onSelectUser = (user: AdminUser) => {
    setSelected(user);
    setFeature(GRANTABLE_FEATURES[0]);
    setExtraUsd("");
    setExpiresAtLocal("");
    setReason("");
  };

  // Din vederea globala: admin.getUser(id) + intrare in modul editare (5.5).
  const onOpenFromGlobal = async (row: GlobalQuotaGrant) => {
    setError(null);
    try {
      const user = await admin.getUser(row.userId);
      setSelected(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la incarcarea utilizatorului.");
    }
  };

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
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
        feature,
        extraUsdMilli: extraMilli,
        expiresAt: isoExpires,
        reason: reason.trim() || null,
      });
      await Promise.all([loadGrants(selected.id), loadGlobal()]);
      setExtraUsd("");
      setExpiresAtLocal("");
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la crearea grant-ului.");
    } finally {
      setBusyId(null);
    }
  };

  const onRevoke = async (grant: QuotaGrant, ownerLabel?: string) => {
    const ok = await confirm({
      title: "Revoca grant",
      message: `Revoca grant-ul de ${milliToUsd(grant.extraUsdMilli)} $ pentru "${quotaFeatureLabel(grant.feature)}"${ownerLabel ? ` (${ownerLabel})` : ""}? Limita efectiva scade imediat.`,
      destructive: true,
      confirmLabel: "Revoca",
    });
    if (!ok) return;
    setBusyId(grant.id);
    setError(null);
    try {
      await admin.revokeGrant(grant.id, null);
      await Promise.all([selected ? loadGrants(selected.id) : Promise.resolve(), loadGlobal()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la revocarea grant-ului.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="min-h-full bg-background p-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Gift className="h-6 w-6 text-primary" />
            Granturi extra buget
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Extra one-shot peste limita de baza, cu expirare. Limita efectiva = limita de baza + suma granturilor
            active.
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
            <CardTitle className="flex items-center justify-between gap-2 text-base">
              <span className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                Granturi active (toti utilizatorii)
              </span>
              <Button variant="outline" size="sm" onClick={loadGlobal} disabled={globalLoading}>
                <RefreshCw className={cn("h-4 w-4", globalLoading && "animate-spin")} />
                Reincarca
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {globalTruncated && (
              <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                Lista e trunchiata la primele 500 de randuri.
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Utilizator</th>
                    <th className="px-3 py-2 font-semibold">Feature</th>
                    <th className="px-3 py-2 font-semibold">Extra</th>
                    <th className="px-3 py-2 font-semibold">Expira</th>
                    <th className="px-3 py-2 font-semibold">Motiv</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {globalGrants.length === 0 && !globalLoading && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                        Nu exista granturi active.
                      </td>
                    </tr>
                  )}
                  {globalGrants.map((g) => (
                    <tr key={g.id} className="border-b border-border last:border-b-0 hover:bg-muted/30">
                      <td className="px-3 py-2 align-top">
                        <p className="font-mono text-xs">{g.email}</p>
                        <p className="text-xs text-muted-foreground">
                          {g.displayName} · {userRoleLabel(g.role)} · {userStatusLabel(g.status)}
                        </p>
                      </td>
                      <td className="px-3 py-2 align-top text-xs">{quotaFeatureLabel(g.feature)}</td>
                      <td className="px-3 py-2 align-top font-mono">${milliToUsd(g.extraUsdMilli)}</td>
                      <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                        {formatIsoDateTime(g.expiresAt)}
                      </td>
                      <td className="px-3 py-2 align-top text-xs">
                        {g.reason ?? <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2 align-top text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => onOpenFromGlobal(g)}>
                            Detalii
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onRevoke(g, g.email)}
                            disabled={busyId === g.id}
                            className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/30"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Acorda grant unui utilizator</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <UserPicker
              value={selected?.id ?? ""}
              onSelect={onSelectUser}
              ariaLabel="Alege utilizatorul pentru grant"
            />

            {selected && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-sm">{selected.email}</span>
                    <Badge variant="outline">{userRoleLabel(selected.role)}</Badge>
                    <Badge variant={selected.status === "active" ? "success" : "warning"}>
                      {userStatusLabel(selected.status)}
                    </Badge>
                  </span>
                  <Button variant="outline" size="sm" onClick={() => loadGrants(selected.id)} disabled={loading}>
                    <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                    Reincarca
                  </Button>
                </div>

                <form onSubmit={onCreate} className="grid gap-3 md:grid-cols-[260px_140px_220px_1fr_auto] md:items-end">
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
                      {GRANTABLE_FEATURES.map((f) => (
                        <option key={f} value={f}>
                          {quotaFeatureLabel(f)}
                        </option>
                      ))}
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
                            Nu exista granturi pentru acest utilizator.
                          </td>
                        </tr>
                      )}
                      {grants.map((g) => {
                        const state = grantState(g);
                        const revoked = g.revokedAt !== null;
                        const expired = isExpired(g);
                        return (
                          <tr key={g.id} className="border-b border-border last:border-b-0 hover:bg-muted/30">
                            <td className="px-3 py-2 align-top text-xs">{quotaFeatureLabel(g.feature)}</td>
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
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

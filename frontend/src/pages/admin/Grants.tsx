import { useCallback, useEffect, useState } from "react";
import { Gift, Plus, RefreshCw, ShieldAlert, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { UserPicker } from "@/components/UserPicker";
import { admin, MonitoringApiError, type AdminUser, type GlobalQuotaGrant, type QuotaGrant } from "@/lib/api";
import { formatIsoDateTime } from "@/lib/datetime-formatters";
import { quotaFeatureLabel } from "@/lib/quotaFeatureLabels";
import { userRoleLabel, userStatusLabel } from "@/lib/userLabels";
import { cn } from "@/lib/utils";

const MILLI = 1000;

// Granturile sunt bugete AI extra — captcha nu are granturi (cap fix per user).
// v2.42.0 (5.2): pool AI unic — granturile exista doar pe "ai".
const GRANTABLE_FEATURES = ["ai"] as const;

function milliToUsd(milli: number): string {
  return (milli / MILLI).toFixed(3);
}

function parseUsdInputToMilli(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Sub 0.001 USD se rotunjeste la 0 milli — invalid (backend cere min 1),
  // altfel guard-ul client lasa sa treaca un request destinat esecului.
  const milli = Math.round(n * MILLI);
  return milli >= 1 ? milli : null;
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
  const toast = useToast();
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [grants, setGrants] = useState<QuotaGrant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feature, setFeature] = useState<string>(GRANTABLE_FEATURES[0]);
  const [extraUsd, setExtraUsd] = useState("");
  const [expiresAtLocal, setExpiresAtLocal] = useState("");
  const [reason, setReason] = useState("");
  const [busyId, setBusyId] = useState<number | "create" | null>(null);
  // v2.41.0: vedere globala la deschidere — granturile active ale tuturor
  // userilor, fara cautarea prealabila a unui user (pandant la pagina Cote).
  const [activeGrants, setActiveGrants] = useState<GlobalQuotaGrant[]>([]);
  const [activeTruncated, setActiveTruncated] = useState(false);
  const [activeLoading, setActiveLoading] = useState(false);

  const loadActiveGrants = useCallback(async () => {
    setActiveLoading(true);
    try {
      const result = await admin.listActiveGrants();
      setActiveGrants(result.grants);
      setActiveTruncated(result.truncated === true);
      // Fara clear, un banner de eroare de la un load esuat anterior persista
      // si dupa un refresh reusit.
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la incarcarea granturilor active.");
    } finally {
      setActiveLoading(false);
    }
  }, []);

  useEffect(() => {
    loadActiveGrants();
  }, [loadActiveGrants]);

  // Fetch-ul per-user traieste in efect cu AbortController + guards (pattern
  // 6.7): golirea sincrona a listei NU anuleaza un fetch in zbor — un raspuns
  // lent pentru userul A ar ateriza dupa selectarea lui B si ar afisa (si
  // permite revocarea) granturilor lui A sub identitatea lui B (finding
  // review-panel confirmat). refreshTick = reincarcare manuala/post-mutatie.
  const [refreshTick, setRefreshTick] = useState(0);
  const refreshGrants = useCallback(() => setRefreshTick((t) => t + 1), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshTick este trigger explicit de reincarcare (pattern 6.7), nu e citit in corp.
  useEffect(() => {
    setGrants([]);
    if (!selected) return;
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    admin
      .listGrants(selected.id, ac.signal)
      .then((result) => {
        if (ac.signal.aborted) return;
        setGrants(result.grants);
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Eroare la incarcarea grant-urilor.");
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [selected, refreshTick]);

  const onSelect = (user: AdminUser) => {
    setSelected(user);
    setFeature(GRANTABLE_FEATURES[0]);
    setExtraUsd("");
    setExpiresAtLocal("");
    setReason("");
  };

  const selectFromActive = async (userId: string) => {
    setError(null);
    try {
      const user = await admin.getUser(userId);
      onSelect(user);
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
      refreshGrants();
      void loadActiveGrants();
      setExtraUsd("");
      setExpiresAtLocal("");
      setReason("");
      toast(`Grant de ${milliToUsd(extraMilli)} $ acordat lui ${selected.email}.`, { variant: "success" });
    } catch (err) {
      // v2.42.0 (5.2): grant vs nelimitat se exclud — serverul e autoritatea.
      // Gating-ul ramane REACTIV (nu proactiv ca in referinta): baza include si
      // default-ul din env, invizibil clientului — un buton dezactivat pe
      // absenta override-ului ar bloca fals granturile valide pe acel default.
      const msg =
        err instanceof MonitoringApiError && err.code === "unlimited_budget"
          ? "Utilizatorul are buget AI nelimitat — granturile nu au efect. Seteaza intai o limita de baza in Cote."
          : err instanceof Error
            ? err.message
            : "Eroare la crearea grant-ului.";
      setError(msg);
    } finally {
      setBusyId(null);
    }
  };

  const onRevoke = async (grant: Pick<QuotaGrant, "id" | "extraUsdMilli" | "feature">, ownerLabel?: string) => {
    const ok = await confirm({
      title: "Revoca grant",
      message: `Revoca grant-ul de ${milliToUsd(grant.extraUsdMilli)} $ pentru "${quotaFeatureLabel(grant.feature)}"${ownerLabel ? ` (${ownerLabel})` : ""}? Limita efectiva va scadea imediat.`,
      destructive: true,
      confirmLabel: "Revoca",
    });
    if (!ok) return;
    setBusyId(grant.id);
    setError(null);
    try {
      await admin.revokeGrant(grant.id, null);
      if (selected) refreshGrants();
      void loadActiveGrants();
      toast(`Grantul de ${milliToUsd(grant.extraUsdMilli)} $ a fost revocat.`, { variant: "success" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la revocarea grant-ului.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className={cn(!embedded && "min-h-full bg-background p-6")}>
      <div className={cn("space-y-5", !embedded && "mx-auto max-w-5xl")}>
        <div>
          {!embedded && (
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <Gift className="h-6 w-6 text-primary" />
              Granturi extra buget
            </h1>
          )}
          <p className={cn("text-sm text-muted-foreground", !embedded && "mt-1")}>
            Extra acordat o singura data peste limita de baza, cu expirare. Limita efectiva = limita de baza + suma
            grant-urilor active. Atentie: daca userul nu are o limita setata (buget nelimitat), grantul nu are niciun
            efect — seteaza intai cota in tab-ul Cote.
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

        <UserPicker value={selected?.id ?? ""} onSelect={onSelect} ariaLabel="Alege utilizatorul pentru grant" />

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
                  Reincarca
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
                            <p className="font-mono text-xs">{g.email}</p>
                            {g.displayName && <p className="text-xs text-muted-foreground">{g.displayName}</p>}
                          </td>
                          <td className="px-3 py-2 align-top text-xs">{quotaFeatureLabel(g.feature)}</td>
                          <td className="px-3 py-2 align-top">{milliToUsd(g.extraUsdMilli)} $</td>
                          <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                            {formatIsoDateTime(g.expiresAt)}
                          </td>
                          <td className="px-3 py-2 align-top text-xs text-muted-foreground">{g.reason ?? "—"}</td>
                          <td className="px-3 py-2 align-top text-right">
                            <div className="flex justify-end gap-1">
                              <Button size="sm" variant="outline" onClick={() => selectFromActive(g.userId)}>
                                Editeaza
                              </Button>
                              {/* Extra pastrat fata de referinta: revocare direct din
                                  vederea globala, fara selectarea prealabila a userului. */}
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => onRevoke(g, g.email)}
                                disabled={busyId === g.id}
                                aria-label={`Revoca grantul pentru ${g.email}`}
                                title="Revoca grantul"
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
                  {activeTruncated && (
                    <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                      Lista arata primele 500 de granturi active — exista mai multe; cauta userul direct pentru restul.
                    </p>
                  )}
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
                  <Badge variant="outline">{userRoleLabel(selected.role)}</Badge>
                  <Badge variant={selected.status === "active" ? "success" : "warning"}>
                    {userStatusLabel(selected.status)}
                  </Badge>
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={refreshGrants} disabled={loading}>
                    <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                    Reincarca
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                    Schimba utilizatorul
                  </Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Feature-ul are o singura optiune cu text lung ("AI — toate analizele
                  (limita unica)") — coloana lui e lata, Motivul preia doar restul. */}
              <form onSubmit={onCreate} className="grid gap-3 md:grid-cols-[260px_140px_220px_1fr_auto] md:items-end">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground" htmlFor="grant-feature">
                    Feature
                  </label>
                  <Select value={feature} onValueChange={setFeature}>
                    <SelectTrigger id="grant-feature">
                      <SelectValue placeholder="Feature" />
                    </SelectTrigger>
                    <SelectContent>
                      {GRANTABLE_FEATURES.map((f) => (
                        <SelectItem key={f} value={f}>
                          {quotaFeatureLabel(f)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                                aria-label="Revoca grantul"
                                title="Revoca grantul"
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

import { Fragment, useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, ChevronDown, ChevronUp, RefreshCw, ShieldAlert, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SortableTh } from "@/components/ui/sortable-th";
import { TablePagination } from "@/components/table-pagination";
import { useClientSort } from "@/hooks/useClientSort";
import {
  admin,
  me,
  type MeBudgetItem,
  type MeBudgetResult,
  type MeBudgetWarning,
  type MeFxRate,
  type QuotaPeriod,
  type UsageOverviewResult,
} from "@/lib/api";
import { formatIsoDateTime } from "@/lib/datetime-formatters";
import { quotaFeatureLabel } from "@/lib/quotaFeatureLabels";
import { userRoleLabel } from "@/lib/userLabels";
import { cn } from "@/lib/utils";

const MILLI = 1000;
const FX_STALE_BADGE_HOURS = 48;
const USER_PAGE_SIZE_DEFAULT = 25;

const PERIOD_LABELS: Record<QuotaPeriod, string> = {
  day: "Zilnic",
  week: "Saptamanal",
  month: "Lunar",
};

const LIMIT_SOURCE_LABELS: Record<"override" | "default" | "none", string> = {
  override: "Cota setata",
  default: "Implicit tenant",
  none: "Fara limita",
};

function milliToUsd(milli: number | null): string {
  if (milli === null) return "—";
  return `$${(milli / MILLI).toFixed(3)}`;
}

// Fail-closed pe EUR: daca rate-ul lipseste sau e stale > 48h, NU afisam o
// valoare numerica. Inlocuim cu placeholder explicit ca admin sa vada problema.
function milliToEur(milli: number | null, fx: MeFxRate): string {
  if (milli === null) return "—";
  if (fx.rate === null || fx.stale) return "EUR indisponibil";
  return `€${((milli / MILLI) * fx.rate).toFixed(3)}`;
}

// Limita 0 = blocat total, nu "nelimitat" — trebuie sa umple bara (100%), nu
// s-o goleasca. `null` ramane exclusiv marcajul de nelimitat.
function pctOf(item: MeBudgetItem): number | null {
  if (item.effectiveLimitMilli === null) return null;
  if (item.effectiveLimitMilli === 0) return 100;
  return Math.min(100, Math.round((item.usedMilli / item.effectiveLimitMilli) * 100));
}

function pctOfPair(used: number, limit: number | null): number | null {
  if (limit === null) return null;
  if (limit === 0) return 100;
  return Math.min(100, Math.round((used / limit) * 100));
}

function barColor(pct: number | null): string {
  if (pct === null) return "bg-emerald-500";
  if (pct >= 100) return "bg-red-500";
  if (pct >= 80) return "bg-amber-500";
  return "bg-primary";
}

export default function UsagePage({ embedded = false }: { embedded?: boolean } = {}) {
  const [budget, setBudget] = useState<MeBudgetResult | null>(null);
  const [warnings, setWarnings] = useState<MeBudgetWarning[]>([]);
  const [overview, setOverview] = useState<UsageOverviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // v2.42.0 (5.3): sub-taburi AI / Captcha + paginare client-side (6.9).
  const [tab, setTab] = useState<"ai" | "captcha">("ai");
  const [userPage, setUserPage] = useState(0);
  const [userPageSize, setUserPageSize] = useState(USER_PAGE_SIZE_DEFAULT);

  // Rand expandabil per userId, doar pe tabelul AI: detaliaza windows
  // (day/week/total) sub randul de sinteza "Consum".
  const [expandedAi, setExpandedAi] = useState<Set<string>>(new Set());
  const toggleAiExpand = (userId: string) => {
    setExpandedAi((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [b, w, o] = await Promise.all([me.budget(), me.budgetWarnings(), admin.usageOverview()]);
      setBudget(b);
      // Contract 3.4: raspunsul e { items }, cu aboveSince (nu { warnings }).
      setWarnings(w.items ?? []);
      setOverview(o);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la incarcarea bugetului.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const fx = budget?.fx ?? { pair: "USD/EUR" as const, rate: null, rateDate: null, stale: true };

  const aiRows = overview?.items ?? [];
  const captchaRows = overview?.captcha ?? [];

  // Sortare client-side pe TOT setul (6.8) — cate un hook per tab.
  // Perioada se sorteaza pe eticheta UMANA (Zilnic/Saptamanal/Lunar), nu pe
  // token — ordinea urmeaza ce vede userul in celula.
  const aiSort = useClientSort(aiRows, {
    email: (r) => r.email,
    used: (r) => r.usedMilli,
    limit: (r) => r.effectiveLimitMilli,
    period: (r) => PERIOD_LABELS[r.period],
  });
  const captchaSort = useClientSort(captchaRows, {
    email: (r) => r.email,
    used: (r) => r.usedCount,
    limit: (r) => r.effectiveLimitCount,
    period: (r) => PERIOD_LABELS[r.period],
  });

  const activeSorted = tab === "ai" ? aiSort.sorted : captchaSort.sorted;
  const userTotalPages = Math.max(1, Math.ceil(activeSorted.length / userPageSize));
  // 6.9: clamp DERIVAT + sincronizare de STATE la schimbarea totalului —
  // altfel "saltul fantoma" inapoi cand totalul creste la loc.
  const safeUserPage = Math.min(userPage, userTotalPages - 1);
  useEffect(() => {
    setUserPage((p) => Math.min(p, userTotalPages - 1));
  }, [userTotalPages]);

  const pageRows = activeSorted.slice(safeUserPage * userPageSize, (safeUserPage + 1) * userPageSize);

  const switchTab = (next: "ai" | "captcha") => {
    setTab(next);
    setUserPage(0);
  };

  return (
    <div className={cn(!embedded && "min-h-full bg-background p-6")}>
      <div className={cn("space-y-5", !embedded && "mx-auto max-w-5xl")}>
        <div className="flex items-start justify-between gap-4">
          <div>
            {!embedded && (
              <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
                <Activity className="h-6 w-6 text-primary" />
                Consum buget
              </h1>
            )}
            <p className={cn("text-sm text-muted-foreground", !embedded && "mt-1")}>
              Fereastra glisanta per feature (zi / saptamana / luna). Conversie EUR via BCE — daca rate-ul e mai vechi
              de 48h, afisarea EUR e blocata pana la urmatoarea sincronizare.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            Reincarca
          </Button>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{error}</span>
          </div>
        )}

        {warnings.length > 0 && (
          <Card className="border-amber-300 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base text-amber-800 dark:text-amber-200">
                <AlertTriangle className="h-4 w-4" />
                Avertizari active
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {warnings.map((w) => (
                  <li key={`${w.feature}:${w.thresholdPct}`} className="flex flex-wrap items-center gap-2">
                    <Badge variant="warning">{quotaFeatureLabel(w.feature)}</Badge>
                    <span>
                      peste {w.thresholdPct}% — episod activ din {formatIsoDateTime(w.aboveSince)}
                    </span>
                    {w.emailSentAt && (
                      <span className="text-xs text-muted-foreground">
                        · email trimis {formatIsoDateTime(w.emailSentAt)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* v2.42.0 (5.3): consum per utilizator — cifrele vin din aceleasi
            functii ca guard-urile, deci coincid cu enforcementul (429). */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between gap-2 text-base">
              <span className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                Consum per utilizator
              </span>
              <span className="flex gap-1">
                <Button size="sm" variant={tab === "ai" ? "default" : "outline"} onClick={() => switchTab("ai")}>
                  AI
                </Button>
                <Button
                  size="sm"
                  variant={tab === "captcha" ? "default" : "outline"}
                  onClick={() => switchTab("captcha")}
                >
                  Captcha RNPM
                </Button>
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!overview && <p className="px-4 py-6 text-center text-muted-foreground">Se incarca…</p>}

            {/* Empty-state pe TAB-UL ACTIV, nu pe lista AI. */}
            {overview && activeSorted.length === 0 && (
              <p className="px-4 py-6 text-center text-muted-foreground">Nu exista utilizatori activi.</p>
            )}

            {overview && activeSorted.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground">
                    <tr>
                      {tab === "ai" ? (
                        <>
                          <SortableTh sort={aiSort} sortKeyName="email">
                            Utilizator
                          </SortableTh>
                          <SortableTh sort={aiSort} sortKeyName="period">
                            Perioada
                          </SortableTh>
                          <SortableTh sort={aiSort} sortKeyName="used">
                            Consum
                          </SortableTh>
                          <SortableTh sort={aiSort} sortKeyName="limit">
                            Limita efectiva
                          </SortableTh>
                          <th className="px-3 py-2 font-semibold uppercase tracking-wider">Grad</th>
                          <th className="px-3 py-2 font-semibold uppercase tracking-wider">Sursa</th>
                        </>
                      ) : (
                        <>
                          <SortableTh sort={captchaSort} sortKeyName="email">
                            Utilizator
                          </SortableTh>
                          <SortableTh sort={captchaSort} sortKeyName="period">
                            Perioada
                          </SortableTh>
                          <SortableTh sort={captchaSort} sortKeyName="used">
                            Rezolvari
                          </SortableTh>
                          <SortableTh sort={captchaSort} sortKeyName="limit">
                            Limita
                          </SortableTh>
                          <th className="px-3 py-2 font-semibold uppercase tracking-wider">Grad</th>
                          <th className="px-3 py-2 font-semibold uppercase tracking-wider">Sursa</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {tab === "ai"
                      ? pageRows.map((row) => {
                          const r = row as (typeof aiRows)[number];
                          const pct = pctOfPair(r.usedMilli, r.effectiveLimitMilli);
                          const isOpen = expandedAi.has(r.userId);
                          return (
                            <Fragment key={r.userId}>
                              <tr className="border-b border-border last:border-b-0 hover:bg-muted/30">
                                <td className="px-3 py-2 align-top">
                                  <p className="font-mono text-xs">{r.email}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {r.displayName} · {userRoleLabel(r.role)}
                                  </p>
                                </td>
                                <td className="px-3 py-2 align-top text-xs">{PERIOD_LABELS[r.period]}</td>
                                <td className="px-3 py-2 align-top font-mono text-xs">
                                  <span className="inline-flex items-center gap-1">
                                    {milliToUsd(r.usedMilli)}
                                    <button
                                      type="button"
                                      onClick={() => toggleAiExpand(r.userId)}
                                      aria-expanded={isOpen}
                                      aria-label={`Detalii consum pentru ${r.email}`}
                                      className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                                    >
                                      {isOpen ? (
                                        <ChevronUp className="h-3.5 w-3.5" />
                                      ) : (
                                        <ChevronDown className="h-3.5 w-3.5" />
                                      )}
                                    </button>
                                  </span>
                                </td>
                                <td className="px-3 py-2 align-top text-xs">
                                  {r.effectiveLimitMilli === null ? (
                                    <Badge variant="success">Nelimitat</Badge>
                                  ) : (
                                    <span className="font-mono">
                                      {milliToUsd(r.effectiveLimitMilli)}
                                      {r.extraFromGrantsMilli > 0 && (
                                        <span className="ml-1 text-muted-foreground">
                                          (+grant {milliToUsd(r.extraFromGrantsMilli)})
                                        </span>
                                      )}
                                    </span>
                                  )}
                                </td>
                                <td className="px-3 py-2 align-top">
                                  <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
                                    <div
                                      className={cn("h-full", barColor(pct))}
                                      style={{ width: pct === null ? "100%" : `${pct}%` }}
                                    />
                                  </div>
                                  {pct !== null && (
                                    <span className="text-xs text-muted-foreground">
                                      {r.effectiveLimitMilli === 0 ? "Blocat" : `${pct}%`}
                                    </span>
                                  )}
                                </td>
                                <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                                  {LIMIT_SOURCE_LABELS[r.limitSource]}
                                </td>
                              </tr>
                              {isOpen && (
                                <tr className="border-b border-border bg-muted/20">
                                  <td colSpan={6} className="px-4 py-2 text-xs text-muted-foreground">
                                    Zilnic (24h): {milliToUsd(r.windows.dayMilli)} ({milliToEur(r.windows.dayMilli, fx)}
                                    ){" · "}
                                    Saptamanal (7 zile): {milliToUsd(r.windows.weekMilli)} (
                                    {milliToEur(r.windows.weekMilli, fx)}){" · "}
                                    Total: {milliToUsd(r.windows.totalMilli)} ({milliToEur(r.windows.totalMilli, fx)})
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })
                      : pageRows.map((row) => {
                          const r = row as (typeof captchaRows)[number];
                          const pct = pctOfPair(r.usedCount, r.effectiveLimitCount);
                          return (
                            <tr key={r.userId} className="border-b border-border last:border-b-0 hover:bg-muted/30">
                              <td className="px-3 py-2 align-top">
                                <p className="font-mono text-xs">{r.email}</p>
                                <p className="text-xs text-muted-foreground">
                                  {r.displayName} · {userRoleLabel(r.role)}
                                </p>
                              </td>
                              <td className="px-3 py-2 align-top text-xs">{PERIOD_LABELS[r.period]}</td>
                              <td className="px-3 py-2 align-top font-mono text-xs">{r.usedCount}</td>
                              <td className="px-3 py-2 align-top text-xs">
                                {r.effectiveLimitCount === null ? (
                                  <Badge variant="success">Nelimitat</Badge>
                                ) : (
                                  <span className="font-mono">{r.effectiveLimitCount} captcha-uri</span>
                                )}
                              </td>
                              <td className="px-3 py-2 align-top">
                                <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
                                  <div
                                    className={cn("h-full", barColor(pct))}
                                    style={{ width: pct === null ? "100%" : `${pct}%` }}
                                  />
                                </div>
                                {pct !== null && (
                                  <span className="text-xs text-muted-foreground">
                                    {r.effectiveLimitCount === 0 ? "Blocat" : `${pct}%`}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                                {LIMIT_SOURCE_LABELS[r.limitSource]}
                              </td>
                            </tr>
                          );
                        })}
                  </tbody>
                </table>
                {/* Nota de trunchiere: sub tabel, vizibila pe ambele taburi. */}
                {overview?.truncated && (
                  <p className="px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                    Lista a fost trunchiata — exista mai multi utilizatori decat pot fi afisati.
                  </p>
                )}
                {/* Bara doar cand exista mai multe pagini (6.9). */}
                {userTotalPages > 1 && (
                  <TablePagination
                    page={safeUserPage}
                    totalPages={userTotalPages}
                    pageSize={userPageSize}
                    onPageChange={setUserPage}
                    onPageSizeChange={(size) => {
                      setUserPageSize(size);
                      setUserPage(0);
                    }}
                  />
                )}
              </div>
            )}

            {/* Sinteza pe tot tenantul — include si consumul ownerilor fara cont
                activ (suspendati/stersi), care nu apar in randurile de mai sus. */}
            {tab === "ai" && overview && (
              <p className="border-t border-border px-1 pt-2 text-xs text-muted-foreground">
                Total tenant (toti userii, inclusiv conturi inactive): Zilnic (24h){" "}
                {milliToUsd(overview.tenantTotals.dayMilli)} ({milliToEur(overview.tenantTotals.dayMilli, fx)}) ·
                Saptamanal (7 zile) {milliToUsd(overview.tenantTotals.weekMilli)} (
                {milliToEur(overview.tenantTotals.weekMilli, fx)}) · Total{" "}
                {milliToUsd(overview.tenantTotals.totalMilli)} ({milliToEur(overview.tenantTotals.totalMilli, fx)})
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <span>Bugetul tau (contul curent)</span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Curs USD/EUR:</span>
                {fx.rate === null ? (
                  <Badge variant="warning">indisponibil</Badge>
                ) : (
                  <>
                    <span className="font-mono">€{fx.rate.toFixed(4)}</span>
                    {fx.rateDate && <span>· {fx.rateDate}</span>}
                    {fx.stale && <Badge variant="warning">invechit &gt; {FX_STALE_BADGE_HOURS}h</Badge>}
                  </>
                )}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!budget ? (
              <p className="px-4 py-6 text-center text-muted-foreground">Se incarca…</p>
            ) : budget.items.length === 0 ? (
              <p className="px-4 py-6 text-center text-muted-foreground">
                Nu ai inregistrat consum AI in fereastra curenta.
              </p>
            ) : (
              <ul className="space-y-4">
                {budget.items.map((item) => {
                  const pct = pctOf(item);
                  return (
                    <li key={item.feature} className="space-y-2 rounded-md border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{quotaFeatureLabel(item.feature)}</span>
                          <Badge variant="outline">{PERIOD_LABELS[item.period]}</Badge>
                          {item.effectiveLimitMilli === null && <Badge variant="success">Nelimitat</Badge>}
                          {/* +grant doar pe bugete limitate — pe nelimitat grantul nu are efect. */}
                          {item.effectiveLimitMilli !== null && item.extraFromGrantsMilli > 0 && (
                            <Badge variant="success">+grant {milliToUsd(item.extraFromGrantsMilli)}</Badge>
                          )}
                        </div>
                        <span className="text-sm text-muted-foreground">
                          {milliToUsd(item.usedMilli)} ({milliToEur(item.usedMilli, fx)})
                          {item.effectiveLimitMilli !== null && (
                            <>
                              {" "}
                              / {milliToUsd(item.effectiveLimitMilli)} ({milliToEur(item.effectiveLimitMilli, fx)})
                            </>
                          )}
                          {pct !== null && (
                            <span className="ml-2 font-semibold">
                              {item.effectiveLimitMilli === 0 ? "Blocat" : `${pct}%`}
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn("h-full transition-all", barColor(pct))}
                          style={{ width: pct === null ? "100%" : `${pct}%` }}
                        />
                      </div>
                      {item.baseLimitMilli !== null && item.extraFromGrantsMilli > 0 && (
                        <p className="text-xs text-muted-foreground">
                          Baza {milliToUsd(item.baseLimitMilli)} + granturi active{" "}
                          {milliToUsd(item.extraFromGrantsMilli)} = {milliToUsd(item.effectiveLimitMilli)}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

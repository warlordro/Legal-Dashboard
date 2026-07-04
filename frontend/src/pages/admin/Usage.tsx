import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, RefreshCw, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  me,
  type MeBudgetItem,
  type MeBudgetResult,
  type MeBudgetWarning,
  type MeFxRate,
  type QuotaPeriod,
} from "@/lib/api";
import { formatIsoDateTime } from "@/lib/datetime-formatters";
import { cn } from "@/lib/utils";

const MILLI = 1000;
const FX_STALE_BADGE_HOURS = 48;

const PERIOD_LABELS: Record<QuotaPeriod, string> = {
  day: "Zilnic",
  week: "Saptamanal",
  month: "Lunar",
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

function pctOf(item: MeBudgetItem): number | null {
  if (item.effectiveLimitMilli === null || item.effectiveLimitMilli === 0) return null;
  return Math.min(100, Math.round((item.usedMilli / item.effectiveLimitMilli) * 100));
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [b, w] = await Promise.all([me.budget(), me.budgetWarnings()]);
      setBudget(b);
      setWarnings(w.items ?? []);
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

  return (
    <div className={embedded ? "" : "min-h-full bg-background p-6"}>
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
              Rolling window per feature (zi / saptamana / luna). Conversie EUR via BCE — daca rate-ul e mai vechi de
              48h, afisarea EUR e blocata pana la urmatoarea sincronizare.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            Refresh
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
                    <Badge variant="warning">{w.feature}</Badge>
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

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <span>Buget per feature</span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Curs USD/EUR:</span>
                {fx.rate === null ? (
                  <Badge variant="warning">indisponibil</Badge>
                ) : (
                  <>
                    <span className="font-mono">€{fx.rate.toFixed(4)}</span>
                    {fx.rateDate && <span>· {fx.rateDate}</span>}
                    {fx.stale && <Badge variant="warning">stale &gt; {FX_STALE_BADGE_HOURS}h</Badge>}
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
                          <span className="font-mono text-sm">{item.feature}</span>
                          <Badge variant="outline">{PERIOD_LABELS[item.period]}</Badge>
                          {item.effectiveLimitMilli === null && <Badge variant="success">Nelimitat</Badge>}
                          {item.extraFromGrantsMilli > 0 &&
                            (item.effectiveLimitMilli === null ? (
                              // Grant peste buget nelimitat = inert: nu are peste ce
                              // sa se adune. Il aratam ca fapt, nu ca beneficiu.
                              <Badge
                                variant="secondary"
                                title="Grantul exista, dar nu are efect cat timp bugetul e nelimitat — devine activ doar daca setezi o limita in Cote."
                              >
                                grant {milliToUsd(item.extraFromGrantsMilli)} — fara efect
                              </Badge>
                            ) : (
                              <Badge variant="success">+grant {milliToUsd(item.extraFromGrantsMilli)}</Badge>
                            ))}
                        </div>
                        <span className="text-sm text-muted-foreground">
                          {milliToUsd(item.usedMilli)} ({milliToEur(item.usedMilli, fx)})
                          {item.effectiveLimitMilli !== null && (
                            <>
                              {" "}
                              / {milliToUsd(item.effectiveLimitMilli)} ({milliToEur(item.effectiveLimitMilli, fx)})
                            </>
                          )}
                          {pct !== null && <span className="ml-2 font-semibold">{pct}%</span>}
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

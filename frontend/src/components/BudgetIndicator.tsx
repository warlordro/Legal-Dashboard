import { useEffect, useState } from "react";
import { Gauge } from "lucide-react";
import { me, type MeBudgetItem } from "@/lib/api";
import { cn } from "@/lib/utils";

interface BudgetIndicatorProps {
  enabled?: boolean;
  className?: string;
}

// v2.42.0: bugetul AI e un pool unic ("ai") peste toate analizele — nu mai
// exista alt feature de afisat, deci nu mai e prop.
const FEATURE = "ai";

export function BudgetIndicator({ enabled = true, className }: BudgetIndicatorProps) {
  const [item, setItem] = useState<MeBudgetItem | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const ac = new AbortController();
    const load = async () => {
      try {
        const budget = await me.budget(ac.signal);
        if (cancelled) return;
        setItem(budget.items.find((row) => row.feature === FEATURE) ?? null);
      } catch {
        if (!cancelled) setItem(null);
      }
    };
    load();
    const interval = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      ac.abort();
      window.clearInterval(interval);
    };
  }, [enabled]);

  if (!enabled || !item || item.limitMilli === null) return null;

  const used = item.usedMilli / 1000;
  const limit = item.limitMilli / 1000;
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;

  return (
    <div className={cn("flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm", className)}>
      <Gauge className="h-4 w-4 text-primary" />
      <span className="font-medium">Buget AI</span>
      <div className="h-2 min-w-28 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular-nums text-muted-foreground">
        ${used.toFixed(3)} / ${limit.toFixed(3)}
      </span>
    </div>
  );
}

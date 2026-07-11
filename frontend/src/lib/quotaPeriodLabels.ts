import type { QuotaPeriod } from "./adminApi";

// v2.43.0: extras din duplicarea PERIOD_LABELS (Usage.tsx + Quota.tsx),
// pattern *Phase.ts (rnpmProgressPhase.ts) — pure helper, testat unit.

export function quotaPeriodLabel(period: QuotaPeriod): string {
  switch (period) {
    case "day":
      return "Zilnic";
    case "week":
      return "Saptamanal";
    case "month":
      return "Lunar";
    default: {
      // Exhaustive guard — TS va eroa daca QuotaPeriod adauga o valoare noua.
      // Fix C11: la runtime un token necunoscut urmeaza conventia repo-ului
      // ("Necunoscut (token)" — pastreaza valoarea pentru diagnosticare),
      // nu se afiseaza brut.
      const _exhaustive: never = period;
      return `Necunoscut (${String(_exhaustive)})`;
    }
  }
}

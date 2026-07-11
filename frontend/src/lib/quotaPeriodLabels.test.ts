import { describe, expect, it } from "vitest";
import { quotaPeriodLabel } from "./quotaPeriodLabels";

// v2.43.0: extras din duplicarea PERIOD_LABELS (Usage.tsx + Quota.tsx),
// pattern *Phase.ts (rnpmProgressPhase.ts) — fallback pe unknown, fara token
// brut in DOM.

describe("quotaPeriodLabel", () => {
  it("mapeaza fiecare perioada cunoscuta la eticheta romaneasca", () => {
    expect(quotaPeriodLabel("day")).toBe("Zilnic");
    expect(quotaPeriodLabel("week")).toBe("Saptamanal");
    expect(quotaPeriodLabel("month")).toBe("Lunar");
  });

  it("valoare necunoscuta => conventia repo-ului: 'Necunoscut (token)', nu token brut", () => {
    // @ts-expect-error - testam fallback-ul pentru un input in afara uniunii QuotaPeriod
    expect(quotaPeriodLabel("year")).toBe("Necunoscut (year)");
  });
});

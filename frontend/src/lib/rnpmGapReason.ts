// v2.20.0: humanize cele 3 cauze de gap RNPM pentru afisare in banner-ul de
// rezultate split. Pure helper — testat unit, fara dependinte UI.
import type { RnpmGapReason, RnpmSplitSubResult } from "@/types/rnpm";

export function describeBlockedSubResult(s: RnpmSplitSubResult): string {
  if (s.status !== "blocked") {
    return `eroare${s.reason ? ": " + s.reason : ""}`;
  }
  // gapReason poate fi undefined la runtime (sub-tipuri vechi din rezultate
  // restored, sau path-uri error care nu au atribuit cauza). Tratat explicit
  // ca sa nu mai mascheze omisiunile in switch-ul exhaustiv.
  if (s.gapReason === undefined) {
    return `blocat (${s.subTotal} > limita)`;
  }
  return describeGapReason(s.gapReason, s.subTotal);
}

function describeGapReason(reason: RnpmGapReason, subTotal: number): string {
  switch (reason) {
    case "terminal_cap":
      return `blocat de limita RNPM (${subTotal} > 1500, fara axa de split)`;
    case "silent_refusal":
      return `blocat de RNPM (raport ${subTotal} dar nicio inregistrare livrata — rate-limit / captcha invalid)`;
    case "residual_unclassified":
      return `blocat partial (${subTotal} raportat, ramas neacoperit dupa tier-2)`;
    default: {
      // Exhaustive guard — TS va eroa daca RnpmGapReason adauga un enum nou
      // si uitam sa-l tratam aici. Runtime fallback ramane safe.
      const _exhaustive: never = reason;
      return `blocat (${subTotal} > limita) [${String(_exhaustive)}]`;
    }
  }
}

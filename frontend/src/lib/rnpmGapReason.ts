// v2.20.0: humanize cele 3 cauze de gap RNPM pentru afisare in banner-ul de
// rezultate split. Pure helper — testat unit, fara dependinte UI.
import type { RnpmSplitSubResult } from "@/types/rnpm";

export function describeBlockedSubResult(s: RnpmSplitSubResult): string {
  if (s.status !== "blocked") {
    return `eroare${s.reason ? ": " + s.reason : ""}`;
  }
  switch (s.gapReason) {
    case "terminal_cap":
      return `blocat de limita RNPM (${s.subTotal} > 1500, fara axa de split)`;
    case "silent_refusal":
      return `blocat de RNPM (raport ${s.subTotal} dar nicio inregistrare livrata — rate-limit / captcha invalid)`;
    case "residual_unclassified":
      return `blocat partial (${s.subTotal} raportat, ramas neacoperit dupa tier-2)`;
    default:
      return `blocat (${s.subTotal} > limita)`;
  }
}

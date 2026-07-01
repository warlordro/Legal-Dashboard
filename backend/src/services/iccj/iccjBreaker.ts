// iccjBreaker — circuit-breaker GLOBAL peste apelurile de retea catre scj.ro, cu
// contorizare PONDERATA pe clasa de apelant. scj.ro vede IP-ul unic al serverului, deci
// un PAT in bucla ar putea amplifica traficul si ar putea tranti breaker-ul pentru
// UI+monitoring. Solutia: esecurile induse de PAT au pondere mica (0.25) si contributia
// lor totala e plafonata SUB prag, deci un PAT singur NU poate deschide breaker-ul; un
// outage real scj.ro (care loveste si UI/monitoring cu pondere 1) il deschide la rata normala.

export type IccjCaller = "ui" | "monitoring" | "pat";

export class IccjBreakerOpenError extends Error {
  readonly code = "ICCJ_BREAKER_OPEN";
  constructor() {
    super("ICCJ temporar indisponibil (circuit breaker deschis).");
    this.name = "IccjBreakerOpenError";
  }
}

// Clamp defensiv (audit): `Number(env) || fallback` lasa treaca valori negative (truthy: -1 || 8 => -1),
// exact bug-class-ul fixat in rate-limit.ts / envPositiveInt din iccjClient.ts. Un THRESHOLD negativ ar
// deschide breaker-ul global la primul distres (outage auto-provocat); un COOLDOWN negativ l-ar face sa
// iasa instant din cooldown (nu mai protejeaza scj.ro). Respinge non-finit / <= 0.
export function clampPositiveIntEnv(raw: number, fallback: number): number {
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}
// Exportat (review): testul bucleaza pana la prag; un `const` local nu ar fi importabil.
export const BREAKER_THRESHOLD = clampPositiveIntEnv(Number(process.env.ICCJ_BREAKER_THRESHOLD), 8); // esecuri distres / fereastra
const BREAKER_WINDOW_MS = 60_000;
const BREAKER_COOLDOWN_MS = clampPositiveIntEnv(Number(process.env.ICCJ_BREAKER_COOLDOWN_MS), 30_000);

// PAT induce 0.25 din greutatea unui esec UI/monitoring; contributia totala PAT e
// plafonata la BREAKER_THRESHOLD-1 (mai jos), deci PAT singur nu deschide breaker-ul.
const PAT_DISTRESS_WEIGHT = 0.25;
let failures: Array<{ t: number; w: number }> = []; // esecuri distres ponderate
let openedAt: number | null = null; // cand s-a deschis
let halfOpenProbeInFlight = false;

// Doar semnale de stare reala scj.ro: HTTP 403/429/5xx + timeout. Anularea de catre
// apelant (AbortError) si erorile de parse (markup drift) NU sunt distres upstream.
function distress(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /HTTP (403|429|5\d\d)|too large|timeout/i.test(msg);
}

export function _resetBreakerForTest(): void {
  failures = [];
  openedAt = null;
  halfOpenProbeInFlight = false;
}

export async function withBreaker<T>(caller: IccjCaller, fn: () => Promise<T>, now: number = Date.now()): Promise<T> {
  failures = failures.filter((f) => now - f.t < BREAKER_WINDOW_MS);

  if (openedAt !== null) {
    const elapsed = now - openedAt;
    if (elapsed < BREAKER_COOLDOWN_MS) {
      // in cooldown toate clasele cedeaza (breaker complet deschis).
      throw new IccjBreakerOpenError();
    }
    // half-open: doar UI/monitoring primesc UN probe controlat de sistem; PAT blocat.
    if (caller === "pat" || halfOpenProbeInFlight) throw new IccjBreakerOpenError();
    halfOpenProbeInFlight = true;
    try {
      const out = await fn();
      openedAt = null;
      failures = [];
      halfOpenProbeInFlight = false; // succes -> inchide
      return out;
    } catch (err) {
      halfOpenProbeInFlight = false;
      // Doar un esec de DISTRES reopeneste. Un esec non-distres (parse/markup drift)
      // inseamna ca scj.ro a RASPUNS -> upstream viu -> inchide, ca breaker-ul sa nu
      // ramana blocat la nesfarsit pe o eroare de parsing.
      if (distress(err)) {
        openedAt = now;
        failures = [];
      } else {
        openedAt = null;
        failures = [];
      }
      throw err;
    }
  }

  try {
    return await fn();
  } catch (err) {
    if (distress(err)) {
      failures.push({ t: now, w: caller === "pat" ? PAT_DISTRESS_WEIGHT : 1 });
      if (failures.length > 1000) failures = failures.slice(-1000); // cap dur pe crestere
      // Plafoneaza contributia totala PAT sub prag: un PAT singur NU poate deschide breaker-ul,
      // dar un outage real scj.ro (loveste si UI/monitoring cu w=1) il deschide normal.
      const patScore = failures.filter((f) => f.w < 1).reduce((s, f) => s + f.w, 0);
      const nonPatScore = failures.filter((f) => f.w >= 1).reduce((s, f) => s + f.w, 0);
      const score = Math.min(patScore, BREAKER_THRESHOLD - 1) + nonPatScore;
      if (score >= BREAKER_THRESHOLD) openedAt = now;
    }
    throw err;
  }
}

import { Solver } from "@2captcha/captcha-solver";

// v2.22.0 — sitekey + pageurl mutate la getter-e lazy ca operatorul sa poata
// hot-swap-a valorile fara rebuild daca RNPM roteste hCaptcha-ul. Citirea
// process.env la apel (nu la module load) evita ordinea de import: dotenv
// se incarca in index.ts dupa ce modulul asta e deja evaluat, deci o
// constanta `process.env.X` la top-level ar fi mereu undefined.
const DEFAULT_RNPM_SITEKEY = "6Lff9LsUAAAAAO1gN9y3YMSyX94MS4Yh5zPqePkT";
const DEFAULT_RNPM_PAGEURL = "https://mj.rnpm.ro/";

export function getRnpmSitekey(): string {
  return process.env.RNPM_SITEKEY?.trim() || DEFAULT_RNPM_SITEKEY;
}
export function getRnpmPageUrl(): string {
  return process.env.RNPM_PAGEURL?.trim() || DEFAULT_RNPM_PAGEURL;
}

// Backwards-compat exports — module load reads default; orice consumator nou
// trebuie sa foloseasca getter-ele de mai sus pentru a respecta override-ul.
export const RNPM_SITEKEY = DEFAULT_RNPM_SITEKEY;
export const RNPM_PAGEURL = DEFAULT_RNPM_PAGEURL;

export type CaptchaProvider = "2captcha" | "capsolver";

export class CaptchaError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "CaptchaError";
    this.cause = cause;
  }
}

export class CaptchaInsufficientFundsError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "CaptchaInsufficientFundsError";
    this.cause = cause;
  }
}

function providerLabel(provider: CaptchaProvider): string {
  return provider === "capsolver" ? "CapSolver" : "2Captcha";
}

function validateKey(apiKey: string, provider: CaptchaProvider): string {
  if (!apiKey || apiKey.trim().length < 10) {
    throw new CaptchaError(`Cheie ${providerLabel(provider)} lipsa sau invalida.`);
  }
  return apiKey.trim();
}

async function solveWith2Captcha(apiKey: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const solver = new Solver(apiKey);
  // SDK-ul @2captcha/captcha-solver nu accepta AbortSignal. Rulam un race: daca signal-ul
  // se aborteaza inainte ca solver.recaptcha() sa se termine, rejectam imediat. Promisiunea
  // originala continua in background pana SDK-ul isi da seama (token-ul va fi consumat dar
  // nu-l mai folosim) — acceptabil ca sa nu blocam UI-ul cu 60s.
  let onAbort: (() => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    if (!signal) return;
    onAbort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort);
  });
  try {
    const solvePromise = solver.recaptcha({
      googlekey: getRnpmSitekey(),
      pageurl: getRnpmPageUrl(),
    });
    const res = signal ? await Promise.race([solvePromise, abortPromise]) : await solvePromise;
    const token = typeof res === "string" ? res : res?.data;
    if (!token) throw new CaptchaError("Raspuns 2Captcha invalid (token lipsa).");
    return token;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    if (e instanceof CaptchaError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    if (/ERROR_ZERO_BALANCE/i.test(msg)) throw new CaptchaInsufficientFundsError("Balanta 2Captcha insuficienta.", e);
    if (/ERROR_WRONG_USER_KEY|ERROR_KEY_DOES_NOT_EXIST/i.test(msg))
      throw new CaptchaError("Cheia 2Captcha este invalida.", e);
    throw new CaptchaError(`Eroare 2Captcha: ${msg}`, e);
  } finally {
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  }
}

const CAPSOLVER_BASE = "https://api.capsolver.com";
const CAPSOLVER_POLL_INTERVAL_MS = 2000;
const CAPSOLVER_MAX_POLLS = 60;
const BALANCE_TIMEOUT_MS = 15_000;

// Sleep care reactioneaza imediat la abort signal. Cu vechiul cod (setTimeout
// neutralizat doar la sfarsitul tick-ului), un abort venit la inceputul unui
// poll putea astepta inca pana la CAPSOLVER_POLL_INTERVAL_MS (2s) inainte sa
// fie observat. Acum signal-ul rejecteaza imediat si timer-ul e curatat ca
// timeout-ul sa nu tina event loop-ul viu.
function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    let onAbort: (() => void) | undefined;
    if (signal) {
      onAbort = () => {
        clearTimeout(timer);
        if (onAbort) signal.removeEventListener("abort", onAbort);
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal.addEventListener("abort", onAbort);
    }
  });
}

async function capsolverPost<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${CAPSOLVER_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new CaptchaError(`CapSolver HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function solveWithCapSolver(apiKey: string, signal?: AbortSignal): Promise<string> {
  type CreateRes = { errorId: number; errorCode?: string; errorDescription?: string; taskId?: string };
  const create = await capsolverPost<CreateRes>(
    "/createTask",
    {
      clientKey: apiKey,
      task: {
        type: "ReCaptchaV2TaskProxyLess",
        websiteURL: getRnpmPageUrl(),
        websiteKey: getRnpmSitekey(),
      },
    },
    signal
  );
  if (create.errorId !== 0 || !create.taskId) {
    const code = create.errorCode ?? "";
    if (/ERROR_KEY_DENIED_ACCESS|ERROR_INVALID_TASK_DATA|ERROR_KEY/i.test(code)) {
      throw new CaptchaError("Cheia CapSolver este invalida.");
    }
    if (/ERROR_ZERO_BALANCE|ERROR_NO_BALANCE|ERROR_NO_FUNDS/i.test(code)) {
      throw new CaptchaInsufficientFundsError("Balanta CapSolver insuficienta.");
    }
    throw new CaptchaError(`Eroare CapSolver: ${create.errorDescription ?? code ?? "necunoscuta"}`);
  }

  type TaskRes = {
    errorId: number;
    errorCode?: string;
    errorDescription?: string;
    status?: "ready" | "processing" | "idle" | "failed";
    solution?: { gRecaptchaResponse?: string };
  };
  for (let i = 0; i < CAPSOLVER_MAX_POLLS; i++) {
    await sleepAbortable(CAPSOLVER_POLL_INTERVAL_MS, signal);
    const poll = await capsolverPost<TaskRes>(
      "/getTaskResult",
      {
        clientKey: apiKey,
        taskId: create.taskId,
      },
      signal
    );
    if (poll.errorId !== 0) {
      throw new CaptchaError(`Eroare CapSolver: ${poll.errorDescription ?? poll.errorCode ?? "necunoscuta"}`);
    }
    if (poll.status === "ready") {
      const token = poll.solution?.gRecaptchaResponse;
      if (!token) throw new CaptchaError("Raspuns CapSolver invalid (token lipsa).");
      return token;
    }
    if (poll.status === "failed") {
      throw new CaptchaError(`CapSolver task esuat: ${poll.errorDescription ?? "necunoscut"}`);
    }
  }
  throw new CaptchaError("CapSolver timeout (>120s).");
}

export type CaptchaMode = "sequential" | "race";

function solveWith(provider: CaptchaProvider, key: string, signal?: AbortSignal): Promise<string> {
  return provider === "capsolver" ? solveWithCapSolver(key, signal) : solveWith2Captcha(key, signal);
}

// Race both providers in parallel; first success wins, loser is aborted. Throws CaptchaError only if both fail.
async function solveRace(
  primary: { key: string; provider: CaptchaProvider },
  other: { key: string; provider: CaptchaProvider },
  signal: AbortSignal | undefined,
  t0: number
): Promise<string> {
  const ctrlA = new AbortController();
  const ctrlB = new AbortController();
  const onOuterAbort = () => {
    ctrlA.abort();
    ctrlB.abort();
  };
  if (signal) signal.addEventListener("abort", onOuterAbort, { once: true });

  const wrap = (slot: "A" | "B", p: { key: string; provider: CaptchaProvider }, ctrl: AbortController) =>
    solveWith(p.provider, p.key, ctrl.signal).then(
      (tok) => ({ ok: true as const, slot, provider: p.provider, tok }),
      (err) => {
        throw { slot, provider: p.provider, err };
      }
    );

  try {
    const winner = await Promise.any([wrap("A", primary, ctrlA), wrap("B", other, ctrlB)]);
    console.log(`[captcha] race done winner=${winner.provider} ${Date.now() - t0}ms`);
    (winner.slot === "A" ? ctrlB : ctrlA).abort();
    return winner.tok;
  } catch (e) {
    if (e instanceof AggregateError) {
      const errs = e.errors
        .map((x) => {
          const info = x as { provider?: string; err?: unknown };
          const msg = info.err instanceof Error ? info.err.message : String(info.err);
          return `${info.provider}: ${msg}`;
        })
        .join(" | ");
      console.log(`[captcha] race FAIL (both) ${Date.now() - t0}ms ${errs}`);
      throw new CaptchaError(`Ambele provider-uri de captcha au esuat: ${errs}`);
    }
    throw e;
  } finally {
    if (signal) signal.removeEventListener("abort", onOuterAbort);
  }
}

export async function solveRnpmCaptcha(
  apiKey: string,
  provider: CaptchaProvider = "2captcha",
  fallbackKey?: string,
  signal?: AbortSignal,
  mode: CaptchaMode = "sequential"
): Promise<string> {
  const key = validateKey(apiKey, provider);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const otherProvider: CaptchaProvider = provider === "capsolver" ? "2captcha" : "capsolver";
  const other = fallbackKey?.trim();
  const haveOther = !!(other && other.length >= 10);
  const t0 = Date.now();
  console.log(`[captcha] solve start provider=${provider} mode=${mode} fallback=${haveOther ? otherProvider : "none"}`);

  if (mode === "race" && haveOther) {
    return solveRace({ key, provider }, { key: other, provider: otherProvider }, signal, t0);
  }

  try {
    const token = await solveWith(provider, key, signal);
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    console.log(`[captcha] solve done provider=${provider} ${Date.now() - t0}ms`);
    return token;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    console.log(
      `[captcha] solve FAIL provider=${provider} ${Date.now() - t0}ms err=${e instanceof Error ? e.message : e}`
    );
    if (haveOther) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const t1 = Date.now();
      console.log(`[captcha] fallback -> ${otherProvider}`);
      try {
        const token = await solveWith(otherProvider, other, signal);
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        console.log(`[captcha] fallback done provider=${otherProvider} ${Date.now() - t1}ms`);
        return token;
      } catch (e2) {
        console.log(
          `[captcha] fallback FAIL provider=${otherProvider} ${Date.now() - t1}ms err=${e2 instanceof Error ? e2.message : e2}`
        );
        throw e2;
      }
    }
    throw e;
  }
}

async function balance2Captcha(apiKey: string, signal: AbortSignal): Promise<number> {
  // SDK-ul @2captcha/captcha-solver nu suporta AbortSignal direct. Folosim
  // race: dupa BALANCE_TIMEOUT_MS, rejectam. Promisiunea originala continua
  // in background (HTTP-ul SDK-ului are propriul timeout intern); important
  // e ca handler-ul nostru sa nu blocheze UI/CLI mai mult decat trebuie.
  const solver = new Solver(apiKey);
  let onAbort: (() => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    onAbort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort);
  });
  try {
    const balance = await Promise.race([solver.balance(), abortPromise]);
    return typeof balance === "number" ? balance : Number(balance);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    const msg = e instanceof Error ? e.message : String(e);
    if (/ERROR_ZERO_BALANCE/i.test(msg)) throw new CaptchaInsufficientFundsError("Balanta 2Captcha insuficienta.", e);
    throw e;
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

async function balanceCapSolver(apiKey: string, signal: AbortSignal): Promise<number> {
  type BalRes = { errorId: number; errorCode?: string; errorDescription?: string; balance?: number };
  const res = await capsolverPost<BalRes>("/getBalance", { clientKey: apiKey }, signal);
  if (res.errorId !== 0 || typeof res.balance !== "number") {
    const code = res.errorCode ?? "";
    const description = res.errorDescription ?? "";
    if (/ERROR_ZERO_BALANCE|ERROR_NO_BALANCE|ERROR_NO_FUNDS/i.test(`${code} ${description}`)) {
      throw new CaptchaInsufficientFundsError("Balanta CapSolver insuficienta.");
    }
    throw new CaptchaError(`Eroare CapSolver: ${res.errorDescription ?? "balanta indisponibila"}`);
  }
  return res.balance;
}

export async function getCaptchaBalance(apiKey: string, provider: CaptchaProvider = "2captcha"): Promise<number> {
  const key = validateKey(apiKey, provider);
  // v2.20.8: timeout 15s ca apelul "Verifica" din UI sa nu agate Settings la
  // infinit cand provider-ul nu raspunde (DNS lent, retea blocata, etc.).
  // AbortSignal.timeout disponibil din Node 17.3 / Electron 22+.
  const signal = AbortSignal.timeout(BALANCE_TIMEOUT_MS);
  try {
    return provider === "capsolver" ? await balanceCapSolver(key, signal) : await balance2Captcha(key, signal);
  } catch (e) {
    if (e instanceof CaptchaInsufficientFundsError) throw e;
    if (e instanceof CaptchaError) throw e;
    // AbortSignal.timeout rejecteaza cu DOMException name=TimeoutError.
    if (e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError")) {
      throw new CaptchaError(`Timeout ${providerLabel(provider)} (>${Math.round(BALANCE_TIMEOUT_MS / 1000)}s).`, e);
    }
    const msg = e instanceof Error ? e.message : String(e);
    throw new CaptchaError(`Eroare ${providerLabel(provider)}: ${msg}`, e);
  }
}

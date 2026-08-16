// @vitest-environment jsdom

// Conectarea stream-ului de alerte in modul web.
//
// Bug 1 (rezolvat anterior): prima conectare deschidea EventSource fara sa se
// asigure ca sesiunea exista, desi RECONECTAREA o facea. EventSource nu trece
// prin apiFetch, deci nu prinde interceptorul de 401 care repara tacit celelalte
// cereri — refuzul ramanea scris in audit.
//
// Bug 2 (acest fisier il acopera): euristica de prospetime a sesiunii e o
// variabila per-tab, nu adevarul cookie-jar-ului. Un cookie sters de un logout
// in alt tab, sau invalidat de o rotatie de secret la redeploy, o lasa pe
// "proaspat". `ensureWebSession()` NEfortat devine atunci un no-op, stream-ul se
// conecteaza fara sesiune valida, ia 401, se reconecteaza, si tot asa — pana la
// ~45 min de refuzuri la interval de 30s, timp in care utilizatorul NU primeste
// alerte desi fereastra pare conectata.
//
// Regula introdusa: o conexiune care moare INAINTE de `open` inseamna ca
// sesiunea a fost refuzata -> urmatoarea incercare FORTEAZA re-mintul. O
// conexiune care a ajuns la `open` si apoi moare e o pana de retea -> NU se
// forteaza, altfel orice hopa de retea ar produce o rafala de sync-uri.

import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncSessionResult } from "@/lib/api";

// Contractul real e un STRING literal, nu un obiect (`api.ts`:
// `export type SyncSessionResult = "ok" | "not_provisioned" | "unavailable" | "error"`).
// Mock-ul e tipat explicit ca sa nu se poata intoarce o forma inexistenta: o
// versiune anterioara a acestui fisier returna `{ ok: true }`, ceea ce ar fi
// trecut verde si ar fi masurat un contract care nu exista.
type EnsureWebSession = (options?: { force?: boolean }) => Promise<SyncSessionResult>;

const calls: string[] = [];
const ensureWebSession = vi.fn<EnsureWebSession>();
let webRuntime = true;

vi.mock("@/lib/api", () => ({
  ensureWebSession: (...args: Parameters<EnsureWebSession>) => ensureWebSession(...args),
  isWebRuntime: () => webRuntime,
}));

vi.mock("@/lib/alertsApi", () => ({
  alertsApi: { unreadCount: vi.fn(async () => 0) },
}));

vi.mock("@/lib/alertsNotificationPref", () => ({
  getAlertsNotificationsEnabled: () => false,
}));

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  onerror: (() => void) | null = null;
  private readonly listeners = new Map<string, () => void>();

  constructor(url: string) {
    this.url = url;
    calls.push(`eventsource:${url}`);
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: () => void): void {
    this.listeners.set(type, handler);
  }

  close(): void {}

  /** Conexiunea a fost acceptata de server. */
  emitOpen(): void {
    this.listeners.get("open")?.();
  }

  /** Conexiunea a murit (401 la handshake, sau pana de retea dupa open). */
  emitError(): void {
    this.onerror?.();
  }
}

let container: HTMLDivElement;
let root: Root;

function resultOf(sequence: SyncSessionResult[]): void {
  let i = 0;
  ensureWebSession.mockImplementation(async (options) => {
    calls.push(options?.force === true ? "ensureWebSession:force" : "ensureWebSession");
    return sequence[Math.min(i++, sequence.length - 1)] ?? "ok";
  });
}

async function renderHook() {
  const { useAlertsStream } = await import("@/hooks/useAlertsStream");
  function Probe() {
    useAlertsStream();
    return null;
  }
  await act(async () => {
    root.render(<Probe />);
  });
}

beforeEach(() => {
  calls.length = 0;
  FakeEventSource.instances.length = 0;
  webRuntime = true;
  ensureWebSession.mockReset();
  resultOf(["ok"]);
  vi.stubGlobal("EventSource", FakeEventSource);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useAlertsStream — prima conectare", () => {
  it("in web, asigura sesiunea INAINTE de a deschide stream-ul", async () => {
    await renderHook();

    expect(FakeEventSource.instances.length).toBe(1);
    expect(calls).toEqual(["ensureWebSession", "eventsource:/api/v1/alerts/stream"]);
  });

  it("prima conectare NU forteaza re-mintul (nu exista inca un esec de handshake)", async () => {
    await renderHook();

    // Asertiunea e pe COMPORTAMENT (fortat vs nefortat), nu pe forma exacta a
    // argumentelor: `ensureWebSession()` si `ensureWebSession(undefined)` sunt
    // echivalente functional, iar un test care le distinge ar pica la o
    // refactorizare inofensiva.
    expect(calls.filter((c) => c.startsWith("ensureWebSession"))).toEqual(["ensureWebSession"]);
  });

  it("in desktop, conecteaza direct si NU cere sesiune web", async () => {
    webRuntime = false;
    await renderHook();

    expect(ensureWebSession).not.toHaveBeenCalled();
    expect(calls).toEqual(["eventsource:/api/v1/alerts/stream"]);
  });
});

describe("useAlertsStream — recuperare din sesiune invalida", () => {
  it("nu deschide stream-ul cand re-mintul esueaza, dar REPROGRAMEAZA reconectarea", async () => {
    // Contraexemplul care trebuie sa pice: o implementare care deschide oricum
    // (comportamentul vechi al lui `.finally`), SI una care se opreste definitiv.
    vi.useFakeTimers();
    resultOf(["error", "error", "ok"]);
    await renderHook();

    expect(FakeEventSource.instances.length).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(FakeEventSource.instances.length).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(FakeEventSource.instances.length).toBe(1);
    expect(ensureWebSession).toHaveBeenCalledTimes(3);
  });

  it("o conexiune moarta INAINTE de open forteaza re-mintul la reconectare", async () => {
    vi.useFakeTimers();
    resultOf(["ok"]);
    await renderHook();

    await act(async () => {
      FakeEventSource.instances[0].emitError();
      await vi.advanceTimersByTimeAsync(1500);
    });

    // Al doilea apel trebuie sa fie fortat: handshake-ul refuzat inseamna ca
    // euristica de prospetime minte, iar un apel nefortat ar fi un no-op.
    expect(calls.filter((c) => c.startsWith("ensureWebSession"))).toEqual([
      "ensureWebSession",
      "ensureWebSession:force",
    ]);
  });

  it("o conexiune moarta DUPA open NU forteaza (pana de retea, nu sesiune invalida)", async () => {
    vi.useFakeTimers();
    resultOf(["ok"]);
    await renderHook();

    await act(async () => {
      FakeEventSource.instances[0].emitOpen();
      FakeEventSource.instances[0].emitError();
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(calls.filter((c) => c.startsWith("ensureWebSession"))).toEqual(["ensureWebSession", "ensureWebSession"]);
    // Nu doar ca s-a cerut sesiunea: reconectarea chiar a avut loc. Fara asertia
    // asta, o implementare care cere sesiunea corect si apoi nu mai conecteaza
    // nimic ar trece verde.
    expect(FakeEventSource.instances.length).toBe(2);
  });

  // Contractul e "orice rezultat diferit de ok reprogrameaza", nu "eroarea
  // reprogrameaza". O implementare care trateaza doar "error" ar lasa un cont
  // neprovizionat sau un bridge indisponibil cu stream-ul mort.
  it.each(["error", "unavailable", "not_provisioned"] as const)(
    "rezultatul %s nu conecteaza, dar reprogrameaza",
    async (bad) => {
      vi.useFakeTimers();
      resultOf([bad, "ok"]);
      await renderHook();

      expect(FakeEventSource.instances.length).toBe(0);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      expect(FakeEventSource.instances.length).toBe(1);
    }
  );

  it("o promisiune RESPINSA nu omoara stream-ul (un listener de sesiune poate arunca)", async () => {
    vi.useFakeTimers();
    let attempt = 0;
    ensureWebSession.mockImplementation(async () => {
      calls.push("ensureWebSession");
      attempt += 1;
      if (attempt <= 2) throw new Error("listener a aruncat");
      return "ok";
    });
    await renderHook();

    expect(FakeEventSource.instances.length).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(ensureWebSession).toHaveBeenCalledTimes(3);
    expect(FakeEventSource.instances.length).toBe(1);
  });

  it("doua erori consecutive produc O SINGURA reincercare programata", async () => {
    // Fara gardul pe timerul deja programat, fiecare eroare ar adauga inca o
    // reconectare si ar inmulti conexiunile.
    vi.useFakeTimers();
    resultOf(["ok"]);
    await renderHook();

    await act(async () => {
      FakeEventSource.instances[0].emitError();
      FakeEventSource.instances[0].emitError();
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(FakeEventSource.instances.length).toBe(2);
  });

  it("dupa unmount, un timer deja programat NU mai conecteaza si nu mai cere sesiune", async () => {
    vi.useFakeTimers();
    resultOf(["error", "ok"]);
    const { useAlertsStream } = await import("@/hooks/useAlertsStream");
    function Probe() {
      useAlertsStream();
      return null;
    }
    await act(async () => {
      root.render(<Probe />);
    });

    const callsBeforeUnmount = calls.length;
    await act(async () => {
      root.render(<></>);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });

    expect(calls.length).toBe(callsBeforeUnmount);
    expect(FakeEventSource.instances.length).toBe(0);
  });
});

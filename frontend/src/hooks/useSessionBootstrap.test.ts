// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement, StrictMode, useEffect } from "react";

// Mock the lib barrel — the hook imports `syncWebSession` from `@/lib/api`.
const mockSync = vi.fn();
vi.mock("@/lib/api", () => ({
  syncWebSession: (...args: unknown[]) => mockSync(...args),
}));

import { useSessionBootstrap, type SessionBootstrap } from "./useSessionBootstrap";

type Capture = { current: SessionBootstrap | null };

function setDesktop(on: boolean): void {
  const w = window as unknown as { desktopApi?: unknown };
  w.desktopApi = on ? {} : undefined;
}

function renderHook() {
  const capture: Capture = { current: null };
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;

  function Probe() {
    const result = useSessionBootstrap();
    useEffect(() => {
      capture.current = result;
    });
    capture.current = result;
    return null;
  }

  act(() => {
    const r = createRoot(container);
    root = r;
    r.render(createElement(Probe));
  });

  return {
    capture,
    async flush() {
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
    },
    unmount() {
      act(() => {
        root?.unmount();
      });
      container.remove();
    },
  };
}

beforeEach(() => {
  mockSync.mockReset();
  setDesktop(false);
  vi.useFakeTimers();
});

afterEach(() => {
  setDesktop(false);
  vi.useRealTimers();
});

describe("useSessionBootstrap", () => {
  it("desktop runtime: ready immediately, no session sync", () => {
    setDesktop(true);
    const h = renderHook();
    expect(h.capture.current?.ready).toBe(true);
    expect(h.capture.current?.status).toBe("ok");
    expect(mockSync).not.toHaveBeenCalled();
    h.unmount();
  });

  it("web runtime: gated until sync settles, then ready (ok)", async () => {
    mockSync.mockResolvedValue("ok");
    const h = renderHook();
    expect(h.capture.current?.ready).toBe(false); // gate active before cookie minted
    await h.flush();
    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(h.capture.current?.ready).toBe(true);
    expect(h.capture.current?.status).toBe("ok");
    h.unmount();
  });

  it("web runtime: surfaces not_provisioned but still unblocks", async () => {
    mockSync.mockResolvedValue("not_provisioned");
    const h = renderHook();
    await h.flush();
    expect(h.capture.current?.ready).toBe(true);
    expect(h.capture.current?.status).toBe("not_provisioned");
    h.unmount();
  });

  it("web runtime: transient error still flips ready (no hang)", async () => {
    mockSync.mockResolvedValue("error");
    const h = renderHook();
    await h.flush();
    // Din 2026-08-16 un esec tranzitoriu se reincearca de cateva ori inainte de
    // montare. Garantia aparata de acest test ramane NESLABITA: dupa epuizarea
    // reincercarilor aplicatia porneste oricum, nu atarna.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(h.capture.current?.ready).toBe(true);
    expect(h.capture.current?.status).toBe("error");
    h.unmount();
  });

  it("web runtime: StrictMode double-invoke mints exactly once", async () => {
    mockSync.mockResolvedValue("ok");
    const capture: Capture = { current: null };
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root | null = null;

    function Probe() {
      capture.current = useSessionBootstrap();
      return null;
    }

    act(() => {
      root = createRoot(container);
      root.render(createElement(StrictMode, null, createElement(Probe)));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(capture.current?.ready).toBe(true);

    act(() => root?.unmount());
    container.remove();
  });
});

// 2026-08-16: cand pregatirea sesiunii esueaza (blip de retea, bridge picat sau
// inca nepornit dupa un redeploy), aplicatia se monteaza oricum si TOATE cererile
// de la pornire iau 401. Fiecare se repara singura, deci utilizatorul nu vede
// nimic - dar auditul primeste o rafala, iar `auth.denied` e clasificat "critical"
// in tabloul de bord, deci pornirile nereusite arata acolo ca incidente de
// securitate si dilueaza semnalul real.
//
// DECIZIE A USERULUI: aplicatia trebuie sa porneasca INTOTDEAUNA. Varianta care
// refuza montarea pana la succes a fost respinsa explicit - disponibilitatea bate
// curatenia jurnalului. De aceea reincercarile sunt MARGINITE si montarea e
// garantata dupa plafon.
describe("useSessionBootstrap — reincercari marginite", () => {
  it("reincearca la esec si se monteaza dupa succes, fara sa mai fie nevoie de reparatii", async () => {
    mockSync.mockResolvedValueOnce("error").mockResolvedValueOnce("error").mockResolvedValueOnce("ok");
    const h = renderHook();

    await h.flush();
    expect(h.capture.current?.ready).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(mockSync).toHaveBeenCalledTimes(3);
    expect(h.capture.current?.ready).toBe(true);
    expect(h.capture.current?.status).toBe("ok");
    h.unmount();
  });

  it("GARANTIE: dupa epuizarea reincercarilor aplicatia SE MONTEAZA oricum", async () => {
    // Testul care apara decizia userului. Contraexemplul care trebuie sa pice: o
    // implementare care reincearca la nesfarsit si lasa utilizatorul blocat in
    // ecranul de asteptare.
    mockSync.mockResolvedValue("error");
    const h = renderHook();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });

    expect(h.capture.current?.ready).toBe(true);
    expect(h.capture.current?.status).toBe("error");
    h.unmount();
  });

  it("nu reincearca pe un esec DEFINITIV de cont (not_provisioned)", async () => {
    // Reincercarea are sens doar pe esecuri tranzitorii. Un cont neprovizionat sau
    // inactiv da acelasi raspuns oricat s-ar reincerca, iar utilizatorul ar astepta
    // degeaba inainte sa vada mesajul care ii explica situatia.
    mockSync.mockResolvedValue("not_provisioned");
    const h = renderHook();

    await h.flush();

    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(h.capture.current?.ready).toBe(true);
    expect(h.capture.current?.status).toBe("not_provisioned");
    h.unmount();
  });

  it("desktop: zero reincercari, zero apeluri", async () => {
    setDesktop(true);
    const h = renderHook();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });

    expect(mockSync).not.toHaveBeenCalled();
    expect(h.capture.current?.ready).toBe(true);
    h.unmount();
  });

  it("unmount in timpul reincercarilor nu mai actualizeaza starea", async () => {
    mockSync.mockResolvedValue("error");
    const h = renderHook();
    await h.flush();
    const callsAtUnmount = mockSync.mock.calls.length;
    h.unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });

    expect(mockSync.mock.calls.length).toBe(callsAtUnmount);
  });
  it("GARANTIE in adancime: chiar daca sync-ul ARUNCA, aplicatia se monteaza", async () => {
    // `syncWebSession` nu arunca azi, dar garantia userului nu are voie sa depinda
    // de un contract pe care o editare viitoare il poate incalca tacit. Fara plasa,
    // o promisiune respinsa ar sari peste montare si ar lasa ecranul de asteptare
    // pe veci - exact hang-ul pe care testul de mai sus pretinde ca-l apara.
    mockSync.mockRejectedValue(new Error("contract incalcat"));
    const h = renderHook();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });

    expect(h.capture.current?.ready).toBe(true);
    expect(h.capture.current?.status).toBe("error");
    h.unmount();
  });

  it("reincercarile au plafon propriu, mai scurt decat prima incercare", async () => {
    // Fara asta, un upstream care ATARNA (nu refuza) tine utilizatorul pe ecranul
    // de asteptare de trei ori mai mult decat inainte de acest pas.
    mockSync.mockResolvedValue("error");
    const h = renderHook();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });

    expect(mockSync.mock.calls[0][0]).toBeUndefined();
    expect(mockSync.mock.calls[1][0]).toBeInstanceOf(AbortSignal);
    h.unmount();
  });
});

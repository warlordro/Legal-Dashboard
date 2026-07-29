// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, beginLogout, ensureWebSession, resetLogoutStateForTests } from "./api";

const SYNC = "/api/v1/auth/oauth2/sync";

function setDesktop(on: boolean): void {
  const w = window as unknown as { desktopApi?: unknown };
  w.desktopApi = on ? {} : undefined;
}

afterEach(() => {
  vi.unstubAllGlobals();
  setDesktop(false);
  resetLogoutStateForTests();
});

describe("apiFetch 401 session recovery", () => {
  it("web: re-mints via the bridge and retries the request once on 401", async () => {
    setDesktop(false);
    let meCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === SYNC) return Promise.resolve({ ok: true, status: 200 } as Response);
      meCalls += 1;
      return Promise.resolve({ ok: meCalls > 1, status: meCalls > 1 ? 200 : 401 } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await apiFetch("/api/v1/me");

    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual(["/api/v1/me", SYNC, "/api/v1/me"]);
  });

  it("web: does NOT retry when the re-mint itself fails", async () => {
    setDesktop(false);
    const fetchMock = vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        String(input) === SYNC ? ({ ok: false, status: 403 } as Response) : ({ ok: false, status: 401 } as Response)
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await apiFetch("/api/v1/me");

    expect(res.status).toBe(401);
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual(["/api/v1/me", SYNC]); // no retry
  });

  it("web: never intercepts a 401 on the auth endpoints themselves", async () => {
    setDesktop(false);
    const fetchMock = vi.fn(() => Promise.resolve({ ok: false, status: 401 } as Response));
    vi.stubGlobal("fetch", fetchMock);

    const res = await apiFetch("/api/v1/auth/refresh", { method: "POST" });

    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("desktop: never intercepts (auth is local, no bridge call)", async () => {
    setDesktop(true);
    const fetchMock = vi.fn(() => Promise.resolve({ ok: false, status: 401 } as Response));
    vi.stubGlobal("fetch", fetchMock);

    const res = await apiFetch("/api/v1/me");

    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("web: passes through a non-401 response untouched", async () => {
    setDesktop(false);
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200 } as Response));
    vi.stubGlobal("fetch", fetchMock);

    const res = await apiFetch("/api/v1/me");

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("web: normalizes a Request input — auth endpoint is not intercepted", async () => {
    setDesktop(false);
    const fetchMock = vi.fn(() => Promise.resolve({ ok: false, status: 401 } as Response));
    vi.stubGlobal("fetch", fetchMock);

    const res = await apiFetch(new Request("http://localhost/api/v1/auth/refresh", { method: "POST" }));

    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1); // skipped via pathname, no re-mint
  });

  it("web: concurrent 401s collapse to a single deduped bridge re-mint", async () => {
    setDesktop(false);
    let syncCalls = 0;
    let openSync: (r: Response) => void = () => {};
    const syncGate = new Promise<Response>((resolve) => {
      openSync = resolve;
    });
    const seen = new Map<string, number>();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === SYNC) {
        syncCalls += 1;
        return syncGate;
      }
      const n = seen.get(url) ?? 0;
      seen.set(url, n + 1);
      return Promise.resolve({ ok: n >= 1, status: n >= 1 ? 200 : 401 } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    const p1 = apiFetch("/api/v1/a");
    const p2 = apiFetch("/api/v1/b");
    // Let both initial requests resolve to 401 and both enter the deduped re-mint
    // before the single bridge POST is allowed to settle.
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    openSync({ ok: true, status: 200 } as Response);
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(syncCalls).toBe(1); // one bridge POST shared by both retries
  });

  // Cursa de la delogare: revocarea jti-ului face ca cererile concurente sa
  // primeasca 401. Fara acest guard, re-mint-ul ar emite un JWT proaspat pe care
  // /oauth2/sign_out nu il sterge — utilizatorul ramane cu o sesiune valida.
  it("web: dupa beginLogout(), un 401 NU mai declanseaza re-mint", async () => {
    setDesktop(false);
    const fetchMock = vi.fn((_input: RequestInfo | URL) => Promise.resolve({ ok: false, status: 401 } as Response));
    vi.stubGlobal("fetch", fetchMock);

    beginLogout();
    const res = await apiFetch("/api/v1/me");

    expect(res.status).toBe(401);
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual(["/api/v1/me"]);
  });

  // Cursa semnalata la review: flagul opreste doar sync-urile NOI. Unul deja
  // pornit isi scrie cookie-ul cand aterizeaza, posibil dupa stergerea din
  // /delogat. beginLogout() trebuie sa il astepte, nu doar sa ridice flagul.
  it("web: beginLogout() asteapta un sync deja pornit", async () => {
    setDesktop(false);
    let releaseSync: ((r: Response) => void) | undefined;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input) === SYNC) {
        return new Promise<Response>((resolve) => {
          releaseSync = resolve;
        });
      }
      return Promise.resolve({ ok: false, status: 401 } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    // Porneste un sync si lasa-l in zbor.
    const inFlight = ensureWebSession();
    await Promise.resolve();
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toContain(SYNC);

    let settled = false;
    const pending = beginLogout().then(() => {
      settled = true;
    });

    // Cat timp sync-ul e in zbor, beginLogout NU are voie sa se rezolve.
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    expect(settled).toBe(false);

    releaseSync?.({ ok: true, status: 200 } as Response);
    await inFlight;
    await pending;
    expect(settled).toBe(true);
  });

  // Rafala de `auth.denied` din audit (2026-07-29) venea din cursa asta: la
  // trezirea tabului, keep-alive-ul pornea sync-ul, iar cererile paginii plecau
  // in paralel cu cookie-ul expirat.
  it("web: o cerere pornita in timpul unui sync asteapta cookie-ul proaspat", async () => {
    setDesktop(false);
    let releaseSync: ((r: Response) => void) | undefined;
    const calls: string[] = [];
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url === SYNC) {
        return new Promise<Response>((resolve) => {
          releaseSync = resolve;
        });
      }
      return Promise.resolve({ ok: true, status: 200 } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    const sync = ensureWebSession();
    await Promise.resolve();
    const pending = apiFetch("/api/v1/me");
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    expect(calls).toEqual([SYNC]); // cererea nu a plecat cat timp sync-ul e in zbor

    releaseSync?.({ ok: true, status: 200 } as Response);
    await sync;
    const res = await pending;

    expect(res.status).toBe(200);
    expect(calls).toEqual([SYNC, "/api/v1/me"]);
  });

  // Poarta nu are voie sa se aplice POST-ului de sync: el ESTE cererea pe care o
  // asteapta reSyncInFlight, deci s-ar bloca la infinit pe propria promisiune.
  it("web: POST-ul de sync nu se blocheaza pe propriul re-mint in zbor", async () => {
    setDesktop(false);
    let syncCalls = 0;
    let releaseFirst: ((r: Response) => void) | undefined;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input) === SYNC) {
        syncCalls += 1;
        // Primul sync (cel dedupat) ramane in zbor; al doilea raspunde imediat.
        if (syncCalls === 1) {
          return new Promise<Response>((resolve) => {
            releaseFirst = resolve;
          });
        }
        return Promise.resolve({ ok: true, status: 200 } as Response);
      }
      return Promise.resolve({ ok: true, status: 200 } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    const inFlight = ensureWebSession();
    await Promise.resolve();
    const res = await apiFetch(SYNC, { method: "POST" });

    expect(res.status).toBe(200);
    expect(syncCalls).toBe(2);

    // Elibereaza sync-ul dedupat: altfel `reSyncInFlight` ar ramane setat si ar
    // bloca poarta din testele urmatoare (starea e per-modul).
    releaseFirst?.({ ok: true, status: 200 } as Response);
    await inFlight;
  });

  it("web: un cookie proaspat nu se re-minteste, dar force=true il re-minteste", async () => {
    setDesktop(false);
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const okSync = () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ data: { expiresAt } }),
        clone: () => ({ json: async () => ({ data: { expiresAt } }) }),
      }) as unknown as Response;
    const fetchMock = vi.fn(() => Promise.resolve(okSync()));
    vi.stubGlobal("fetch", fetchMock);

    expect(await ensureWebSession()).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Preventiv (keep-alive / reconectare SSE): fara request.
    expect(await ensureWebSession()).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Recuperare din 401: obligatoriu re-mint, indiferent de prospetime.
    expect(await ensureWebSession({ force: true })).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("web: a non-auth URL with /api/v1/auth/ only in the query is still intercepted", async () => {
    setDesktop(false);
    let meCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input) === SYNC) return Promise.resolve({ ok: true, status: 200 } as Response);
      meCalls += 1;
      return Promise.resolve({ ok: meCalls > 1, status: meCalls > 1 ? 200 : 401 } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await apiFetch("/api/v1/me?next=/api/v1/auth/x");

    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toContain(SYNC); // pathname is /api/v1/me -> re-mint ran
  });
});

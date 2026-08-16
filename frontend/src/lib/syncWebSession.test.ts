// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { syncWebSession } from "./api";

// Pass an explicit signal so the default AbortSignal.timeout(10s) timer is never
// created in tests (avoids dangling handles).
const dummySignal = (): AbortSignal => new AbortController().signal;

function stubFetch(res: { ok: boolean; status: number }): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue(res as Response);
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("syncWebSession", () => {
  it("POSTs to the oauth2 bridge endpoint", async () => {
    const fetchMock = stubFetch({ ok: true, status: 200 });
    await syncWebSession(dummySignal());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/auth/oauth2/sync");
    expect(init.method).toBe("POST");
  });

  it("maps HTTP responses to outcomes", async () => {
    stubFetch({ ok: true, status: 200 });
    expect(await syncWebSession(dummySignal())).toBe("ok");
    stubFetch({ ok: false, status: 403 });
    expect(await syncWebSession(dummySignal())).toBe("not_provisioned");
    // 503 e ambiguu si depinde de SURSA: fara envelope-ul aplicatiei inseamna
    // infrastructura in tranzitie, deci tranzitoriu. Cazul definitiv are test propriu.
    stubFetch({ ok: false, status: 503 });
    expect(await syncWebSession(dummySignal())).toBe("error");
    stubFetch({ ok: false, status: 400 });
    expect(await syncWebSession(dummySignal())).toBe("unavailable");
    stubFetch({ ok: false, status: 500 });
    expect(await syncWebSession(dummySignal())).toBe("error");
  });

  it("returns 'error' on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    expect(await syncWebSession(dummySignal())).toBe("error");
  });
  // Un 503 de la infrastructura (ingress in redeploy, poarta repornind) NU e o
  // configurare invalida: e tranzitoriu. Tratat ca definitiv, opreste reincercarile si
  // lasa utilizatorul pe ecranul de eroare pana la un refresh manual - exact incalcarea
  // garantiei ca aplicatia porneste INTOTDEAUNA.
  it("503 FARA envelope (infrastructura) e tranzitoriu, nu configurare invalida", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>Service Unavailable</html>", { status: 503 }))
    );

    expect(await syncWebSession()).toBe("error");
  });

  it("503 CU envelope de aplicatie ramane definitiv", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: null, error: { code: "bridge_disabled" } }), {
            status: 503,
            headers: { "content-type": "application/json" },
          })
      )
    );

    expect(await syncWebSession()).toBe("unavailable");
  });

  // Terminarea trebuie sa fie proprietatea apelantului: daca semnalul nu ajunge la
  // fetch, un raspuns care atarna tine pornirea la infinit, iar suita ramane verde.
  it("transmite semnalul de anulare mai departe la fetch", async () => {
    let seen: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_i: RequestInfo | URL, init?: RequestInit) => {
        seen = init?.signal ?? undefined;
        return new Response(null, { status: 200 });
      })
    );

    await syncWebSession(AbortSignal.timeout(1000));

    expect(seen).toBeInstanceOf(AbortSignal);
  });
});

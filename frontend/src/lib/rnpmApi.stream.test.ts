// Transport in flux pentru cautarea RNPM. Contractul de fata: ce vede
// utilizatorul NU se schimba — `rnpmSearch` arunca exact aceleasi obiecte de
// eroare ca pe calea JSON, iar rezultatele se intorc o singura data, la final.
// Fluxul e doar mecanism de transport, ca intermediarii sa nu mai taie tacerea.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, formatRnpmStorageLimitError, RnpmLimitExceededError, rnpmSearch } from "./rnpmApi";

afterEach(() => {
  vi.unstubAllGlobals();
});

function sseResponse(...events: Array<{ event: string; data: unknown }>) {
  const body = events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const OK_PAYLOAD = {
  searchId: 5,
  total: 2,
  pagesTotal: 1,
  pageSize: 25,
  currentPage: 1,
  criteriu: "c",
  documents: [],
  avizIds: [],
  detailsFailed: [],
  gcode: "g",
  nextRnpmPage: null,
};

describe("rnpmSearch pe transport in flux", () => {
  it("cere explicit fluxul si intoarce payload-ul din evenimentul result", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse({ event: "ping", data: {} }, { event: "result", data: OK_PAYLOAD })
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await rnpmSearch("ipoteci", {}, "key");

    expect(out).toMatchObject({ searchId: 5, total: 2 });
    const init = (fetchMock.mock.calls as unknown as unknown[][])[0]?.[1] as RequestInit | undefined;
    const headers = new Headers(init?.headers);
    expect(headers.get("accept")).toContain("text/event-stream");
  });

  it("LIMIT_EXCEEDED din flux produce acelasi RnpmLimitExceededError ca azi", async () => {
    vi.stubGlobal("fetch", async () =>
      sseResponse({
        event: "error",
        data: {
          status: 400,
          body: {
            data: null,
            error: {
              code: "LIMIT_EXCEEDED",
              message: "Prea multe rezultate",
              details: { total: 1501, limit: 1500, splittable: { type: "fiducii" } },
            },
            requestId: "rid-1",
          },
        },
      })
    );

    await expect(rnpmSearch("ipoteci", {}, "key")).rejects.toBeInstanceOf(RnpmLimitExceededError);
    await expect(rnpmSearch("ipoteci", {}, "key")).rejects.toMatchObject({
      total: 1501,
      limit: 1500,
      splittableType: "fiducii",
    });
  });

  it("limita de stocare din flux ramane ApiError cu details, deci mesajul cu cifre se pastreaza", async () => {
    vi.stubGlobal("fetch", async () =>
      sseResponse({
        event: "error",
        data: {
          status: 429,
          body: {
            data: null,
            error: {
              code: "QUOTA_EXCEEDED",
              message: "mesaj server",
              details: { feature: "rnpm.storage", usedBytes: 600 * 1024 * 1024, limitBytes: 500 * 1024 * 1024 },
            },
            requestId: "rid-2",
          },
        },
      })
    );

    const err = await rnpmSearch("ipoteci", {}, "key").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(formatRnpmStorageLimitError(err)).toContain("600.0 MB");
  });

  it("un flux terminat fara eveniment terminal arunca, nu intoarce undefined", async () => {
    vi.stubGlobal("fetch", async () => sseResponse({ event: "ping", data: {} }));

    await expect(rnpmSearch("ipoteci", {}, "key")).rejects.toThrow(/incomplet/i);
  });

  it("raspunsul JSON simplu ramane tratat ca azi (negociere refuzata)", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify(OK_PAYLOAD), { status: 200, headers: { "content-type": "application/json" } })
    );

    await expect(rnpmSearch("ipoteci", {}, "key")).resolves.toMatchObject({ searchId: 5 });
  });
});

describe("rnpmSearch pe flux — robustete parsare", () => {
  it("nu trunchiaza payload-ul care contine separatori Unicode de linie", async () => {
    // U+2028/U+2029 sunt valide in siruri JSON si NU sunt escapate de
    // JSON.stringify. Un regex multiline le-ar trata ca sfarsit de linie si ar
    // taia payload-ul; calea JSON veche nu avea problema asta.
    const payload = { ...OK_PAYLOAD, criteriu: "linie noua paragraf" };
    vi.stubGlobal("fetch", async () => sseResponse({ event: "result", data: payload }));

    const out = await rnpmSearch("ipoteci", {}, "key");

    expect(out.criteriu).toBe("linie noua paragraf");
  });
});

// `includeDetails` pe `POST /api/rnpm/search` — detaliile avizelor atasate
// raspunsului cautarii, cerute de integrator ca sa nu mai faca N cereri
// `GET /saved/:id` dupa fiecare cautare.
//
// Contractul, in trei puncte:
//   (a) OPT-IN strict. Fara campul din corp, raspunsul ramane cel de azi, camp
//       cu camp — pinuit separat de rnpm.searchPayload.characterization.test.ts.
//   (b) ZERO cereri noi catre RNPM. Detaliile sunt deja aduse si scrise in baza
//       in timpul cautarii (`avizIds` e dovada); aici doar se citesc inapoi.
//   (c) DEGRADARE, nu esec. O cautare platita cu captcha nu are voie sa se
//       piarda intr-un 500 pentru ca citirea de la final a dat gres.
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestIdContext } from "../middleware/requestId.ts";
import { getAvizeByIds } from "../db/avizRepository.ts";
import { executeSearch } from "../services/rnpmSearchService.ts";
import { rnpmRouter } from "./rnpm.ts";

vi.mock("../services/rnpmSearchService.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/rnpmSearchService.ts")>();
  return { ...actual, executeSearch: vi.fn() };
});

vi.mock("../db/avizRepository.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/avizRepository.ts")>();
  return { ...actual, getAvizeByIds: vi.fn() };
});

function buildApp() {
  const app = new Hono();
  app.use("*", requestIdContext);
  app.route("/api/v1/rnpm", rnpmRouter);
  return app;
}

type SearchResult = Awaited<ReturnType<typeof executeSearch>>;

function mockSearch(over: Partial<SearchResult> = {}) {
  vi.mocked(executeSearch).mockResolvedValueOnce({
    searchId: 42,
    documents: [],
    avizIds: [11, 22, 33],
    detailsFailed: [],
    total: 3,
    pagesTotal: 1,
    pageSize: 25,
    currentPage: 1,
    criteriu: "criteriu-test",
    gcode: "gcode-test",
    nextRnpmPage: null,
    captchasUsed: 1,
    ...over,
  } as unknown as SearchResult);
}

// Forma minima a unui `AvizFull`; testele verifica identitatea si ordinea, nu
// continutul — acela e acoperit de testele repository-ului. Id-ul sta pe
// `aviz.id`, nu la radacina: raspunsul e exact obiectul dat azi de
// `GET /saved/:id`, ca integratorul sa parseze o singura forma.
function aviz(id: number) {
  return {
    aviz: { id, identificator: `AV-${id}` },
    creditori: [],
    debitori: [],
    bunuri: [],
    istoric: [],
  };
}

function detailIds(details: { aviz: { id: number } }[]): number[] {
  return details.map((d) => d.aviz.id);
}

async function postSearch(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return buildApp().request("/api/v1/rnpm/search", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ type: "ipoteci", params: {}, captchaKey: "x".repeat(20), ...body }),
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /rnpm/search — includeDetails este opt-in", () => {
  it("fara camp: raspunsul nu contine `details` si nu citeste din baza", async () => {
    mockSearch();

    const res = await postSearch({});
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body).not.toHaveProperty("details");
    expect(vi.mocked(getAvizeByIds)).not.toHaveBeenCalled();
  });

  it('camp non-boolean (`"true"` ca text) NU activeaza detaliile', async () => {
    mockSearch();

    const res = await postSearch({ includeDetails: "true" });
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body).not.toHaveProperty("details");
    expect(vi.mocked(getAvizeByIds)).not.toHaveBeenCalled();
  });

  it("includeDetails=false pastreaza raspunsul de azi", async () => {
    mockSearch();

    const res = await postSearch({ includeDetails: false });
    const body = (await res.json()) as Record<string, unknown>;

    expect(body).not.toHaveProperty("details");
    expect(vi.mocked(getAvizeByIds)).not.toHaveBeenCalled();
  });
});

describe("POST /rnpm/search — forma raspunsului cu includeDetails", () => {
  it("adauga `details` peste campurile de azi, fara sa scoata vreunul", async () => {
    mockSearch();
    vi.mocked(getAvizeByIds).mockReturnValueOnce([aviz(33), aviz(22), aviz(11)] as unknown as ReturnType<
      typeof getAvizeByIds
    >);

    const res = await postSearch({ includeDetails: true });
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(
      [
        "avizIds",
        "criteriu",
        "currentPage",
        "details",
        "detailsFailed",
        "documents",
        "gcode",
        "nextRnpmPage",
        "pageSize",
        "pagesTotal",
        "searchId",
        "total",
      ].sort()
    );
    // Campurile interne raman ascunse si pe calea noua.
    expect(body).not.toHaveProperty("captchasUsed");
  });

  it("ordinea din `details` urmeaza `avizIds`, nu ordinea bazei", async () => {
    mockSearch({ avizIds: [11, 22, 33] });
    // Repository-ul citeste `ORDER BY id DESC` — daca ruta ar returna direct ce
    // primeste, integratorul ar corela gresit detaliile cu documentele.
    vi.mocked(getAvizeByIds).mockReturnValueOnce([aviz(33), aviz(22), aviz(11)] as unknown as ReturnType<
      typeof getAvizeByIds
    >);

    const res = await postSearch({ includeDetails: true });
    const body = (await res.json()) as { details: { aviz: { id: number } }[] };

    expect(detailIds(body.details)).toEqual([11, 22, 33]);
  });

  it("cere din baza exact id-urile nenule, o singura data", async () => {
    mockSearch({ avizIds: [11, null, 33] });
    vi.mocked(getAvizeByIds).mockReturnValueOnce([aviz(33), aviz(11)] as unknown as ReturnType<typeof getAvizeByIds>);

    await postSearch({ includeDetails: true });

    expect(vi.mocked(getAvizeByIds)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getAvizeByIds).mock.calls[0]?.[0]).toEqual([11, 33]);
  });

  it("un id repetat in `avizIds` apare O SINGURA DATA in `details`", async () => {
    // `saveAvizFull` face upsert pe `(owner_id, identificator)`, deci doua
    // documente cu acelasi identificator primesc acelasi id. Trimiterea lui de
    // doua ori in `IN (...)` ar fi risipa, iar emiterea aceluiasi aviz de doua
    // ori ar umfla raspunsul degeaba. Consecinta asupra contractului: corelarea
    // se face pe `aviz.id`, nu pe pozitie — documentat in API.md §5b.
    mockSearch({ avizIds: [11, 11, 33] });
    vi.mocked(getAvizeByIds).mockReturnValueOnce([aviz(33), aviz(11)] as unknown as ReturnType<typeof getAvizeByIds>);

    const res = await postSearch({ includeDetails: true });
    const body = (await res.json()) as { details: { aviz: { id: number } }[] };

    expect(vi.mocked(getAvizeByIds).mock.calls[0]?.[0]).toEqual([11, 33]);
    expect(detailIds(body.details)).toEqual([11, 33]);
  });

  it("`details` sta la finalul obiectului, deci campurile de azi isi pastreaza ordinea", async () => {
    // Promisiunea "raspunsul de azi ramane neschimbat" e despre bytes, nu doar
    // despre setul de chei: o reordonare a campurilor ar trece o asertie pe
    // chei sortate, dar ar rupe orice client care compara raspunsuri brute.
    mockSearch();
    vi.mocked(getAvizeByIds).mockReturnValueOnce([aviz(11)] as unknown as ReturnType<typeof getAvizeByIds>);

    const res = await postSearch({ includeDetails: true });
    const body = (await res.json()) as Record<string, unknown>;

    expect(Object.keys(body)).toEqual([
      "searchId",
      "total",
      "pagesTotal",
      "pageSize",
      "currentPage",
      "criteriu",
      "documents",
      "avizIds",
      "detailsFailed",
      "gcode",
      "nextRnpmPage",
      "details",
    ]);
  });
});

describe("POST /rnpm/search — avize fara detalii aduse", () => {
  it("`avizIds` cu goluri si `detailsFailed` nevid nu rup raspunsul", async () => {
    mockSearch({ avizIds: [11, null, 33], detailsFailed: ["AV-lipsa"] });
    vi.mocked(getAvizeByIds).mockReturnValueOnce([aviz(33), aviz(11)] as unknown as ReturnType<typeof getAvizeByIds>);

    const res = await postSearch({ includeDetails: true });
    const body = (await res.json()) as { details: { aviz: { id: number } }[]; detailsFailed: string[] };

    expect(res.status).toBe(200);
    // Avizele fara detalii lipsesc din sectiune; `detailsFailed` ramane semnalul.
    expect(detailIds(body.details)).toEqual([11, 33]);
    expect(body.detailsFailed).toEqual(["AV-lipsa"]);
  });

  it("un aviz disparut din baza intre scriere si citire e sarit, nu null", async () => {
    mockSearch({ avizIds: [11, 22] });
    vi.mocked(getAvizeByIds).mockReturnValueOnce([aviz(11)] as unknown as ReturnType<typeof getAvizeByIds>);

    const res = await postSearch({ includeDetails: true });
    const body = (await res.json()) as { details: { aviz: { id: number } }[] };

    expect(body.details).toHaveLength(1);
    expect(body.details[0]?.aviz.id).toBe(11);
  });

  it("zero avize salvate: `details` e lista goala, fara interogare", async () => {
    mockSearch({ avizIds: [null, null], detailsFailed: ["a", "b"] });

    const res = await postSearch({ includeDetails: true });
    const body = (await res.json()) as { details: unknown[] };

    expect(res.status).toBe(200);
    expect(body.details).toEqual([]);
    expect(vi.mocked(getAvizeByIds)).not.toHaveBeenCalled();
  });
});

describe("POST /rnpm/search — citirea detaliilor esueaza", () => {
  it("cautarea nu se pierde: 200 cu campurile de azi, fara `details`", async () => {
    mockSearch();
    // Cazul real: o restaurare de baza porneste dupa ce cautarea s-a terminat,
    // iar `getRnpmDb` refuza citirea. Captcha e deja platita — un 500 aici ar
    // arunca la gunoi o cautare reusita.
    vi.mocked(getAvizeByIds).mockImplementationOnce(() => {
      throw new Error("RESTORE_IN_PROGRESS");
    });

    const res = await postSearch({ includeDetails: true });
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body).not.toHaveProperty("details");
    expect(body.searchId).toBe(42);
    expect(body.avizIds).toEqual([11, 22, 33]);
  });
});

describe("POST /rnpm/search — includeDetails pe transportul in flux", () => {
  it("evenimentul `result` poarta aceleasi detalii ca raspunsul JSON", async () => {
    mockSearch();
    vi.mocked(getAvizeByIds).mockReturnValueOnce([aviz(33), aviz(22), aviz(11)] as unknown as ReturnType<
      typeof getAvizeByIds
    >);

    const res = await postSearch({ includeDetails: true }, { accept: "text/event-stream" });
    const text = await res.text();

    const line = text.split("\n").find((l) => l.startsWith("data: ") && l.includes("searchId"));
    expect(line).toBeDefined();
    const payload = JSON.parse((line as string).slice("data: ".length)) as { details: { aviz: { id: number } }[] };

    expect(detailIds(payload.details)).toEqual([11, 22, 33]);
  });

  it("citirea esuata degradeaza si pe flux: eveniment `result`, nu `error`", async () => {
    mockSearch();
    vi.mocked(getAvizeByIds).mockImplementationOnce(() => {
      throw new Error("RESTORE_IN_PROGRESS");
    });

    const res = await postSearch({ includeDetails: true }, { accept: "text/event-stream" });
    const text = await res.text();

    // Cautarea a reusit — clientul trebuie sa primeasca rezultatul, nu o eroare.
    expect(text).toContain("event: result");
    expect(text).not.toContain("event: error");

    const line = text.split("\n").find((l) => l.startsWith("data: ") && l.includes("searchId"));
    const payload = JSON.parse((line as string).slice("data: ".length)) as Record<string, unknown>;
    expect(payload).not.toHaveProperty("details");
    expect(payload.searchId).toBe(42);
  });

  it("fluxul fara camp ramane raspunsul de azi", async () => {
    mockSearch();

    const res = await postSearch({}, { accept: "text/event-stream" });
    const text = await res.text();

    const line = text.split("\n").find((l) => l.startsWith("data: ") && l.includes("searchId"));
    const payload = JSON.parse((line as string).slice("data: ".length)) as Record<string, unknown>;

    expect(payload).not.toHaveProperty("details");
    expect(vi.mocked(getAvizeByIds)).not.toHaveBeenCalled();
  });
});

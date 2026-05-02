import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "./api";

// Caracterizeaza parser-ul SSE folosit de api.dosare.loadMore /
// api.termene.loadMore (loadMoreSSE in api.ts). Aceste teste protejeaza
// Stage 2a (fix silent catches) si Stage 8 (split api.ts pe domenii) — orice
// rescriere trebuie sa pastreze comportamentul observat aici in v2.7.0,
// inclusiv bug-urile cunoscute (documentate explicit mai jos) ca refactorul
// sa fie luat in considerare cand fix-ul e implementat.

function makeSseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i]));
      i++;
    },
  });
}

function makeJsonErrorResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeSseResponse(chunks: string[]): Response {
  return new Response(makeSseStream(chunks), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("loadMoreSSE (via api.dosare.loadMore)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("acumuleaza batch-uri si returneaza warnings din evenimentul done", async () => {
    fetchSpy.mockResolvedValue(
      makeSseResponse([
        'event: progress\ndata: {"processed":10,"total":100,"found":2,"currentInterval":"interval-1"}\n',
        '\nevent: batch\ndata: {"data":[{"numar":"1/1/2024"},{"numar":"2/1/2024"}]}\n',
        '\nevent: batch\ndata: {"data":[{"numar":"3/1/2024"}]}\n',
        '\nevent: done\ndata: {"total":3,"warnings":["interval X timeout"]}\n\n',
      ]),
    );

    const progress: number[] = [];
    const onProgress = vi.fn((p) => progress.push(p.processed));
    const result = await api.dosare.loadMore({} as any, onProgress);

    expect(result.data).toHaveLength(3);
    expect(result.total).toBe(3);
    expect(result.warnings).toEqual(["interval X timeout"]);
    expect(result.partial).toBeUndefined();
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(progress).toEqual([10]);
  });

  it("BUG cunoscut v2.7.0: event si data fragmentate intre 2 read()-uri pierd asocierea", async () => {
    // currentEvent este declarat local in interiorul while-loop-ului si se
    // reseteaza la fiecare read(). Daca "event: X" cade in chunk N si
    // "data: Y" se completeaza in chunk N+1 (sau invers), data-ul ramane
    // unbound si nu se proceseaza. Acest test pastreaza comportamentul curent;
    // un fix viitor (mutarea currentEvent in afara while) trebuie sa actualizeze
    // expectatia si sa adauge un test pentru noul flow corect.
    fetchSpy.mockResolvedValue(
      makeSseResponse([
        'event: batch\ndata: {"data":[{"nu',
        'mar":"1/1/2024"}]}\nevent: done\ndata: {"total":1,"warnings":[]}\n\n',
      ]),
    );

    const result = await api.dosare.loadMore({} as any);
    // Data-ul orfan din chunk 2 nu se proceseaza, dar event/data done din chunk 2
    // sunt pe acelasi read si lucreaza corect — deci doneResult se seteaza,
    // accumulated ramane gol, returnam empty success (nu partial).
    expect(result.data).toHaveLength(0);
    expect(result.partial).toBeUndefined();
  });

  it("BUG cunoscut v2.7.0: event:error livreaza mesaj generic, nu parsed.error", async () => {
    // Inner catch (line 116) inghite orice Error cu mesaj != "Eroare la
    // incarcarea extinsa." crezand ca e JSON parse error. Doar cand
    // parsed.error e absent (fallback la "Eroare la incarcarea extinsa.")
    // mesajul propagat ajunge inca prin outer catch. In ambele cazuri
    // outer catch rescrie mesajul la "Conexiunea a fost intrerupta..."
    // daca accumulated == 0. Stage 2a trebuie sa repare aceasta dubla
    // pierdere de informatie.
    fetchSpy.mockResolvedValue(
      makeSseResponse([
        'event: error\ndata: {"error":"Upstream PortalJust 503"}\n\n',
      ]),
    );

    await expect(api.dosare.loadMore({} as any)).rejects.toThrow(
      "Conexiunea a fost intrerupta inainte de finalizare.",
    );
  });

  it("arunca generic message daca raspunsul HTTP nu e ok si body-ul nu e JSON", async () => {
    fetchSpy.mockResolvedValue(
      new Response("internal server error", { status: 500 }),
    );

    await expect(api.dosare.loadMore({} as any)).rejects.toThrow(
      "Eroare la incarcarea extinsa.",
    );
  });

  it("propaga error.message din JSON cand HTTP nu e ok", async () => {
    fetchSpy.mockResolvedValue(
      makeJsonErrorResponse(429, { error: "rate limit hit" }),
    );

    await expect(api.dosare.loadMore({} as any)).rejects.toThrow(
      "rate limit hit",
    );
  });

  it("intoarce partial cu accumulated cand stream-ul se incheie fara done", async () => {
    fetchSpy.mockResolvedValue(
      makeSseResponse([
        'event: batch\ndata: {"data":[{"numar":"1/1/2024"}]}\n\n',
      ]),
    );

    const result = await api.dosare.loadMore({} as any);
    expect(result.partial).toBe(true);
    expect(result.data).toHaveLength(1);
  });

  it("arunca generic error cand nu se livreaza nimic", async () => {
    fetchSpy.mockResolvedValue(makeSseResponse([]));

    await expect(api.dosare.loadMore({} as any)).rejects.toThrow(
      "Conexiunea a fost intrerupta inainte de finalizare.",
    );
  });

  it("ignora data: cu JSON malformed (silent catch documentat pentru Stage 2a)", async () => {
    // Comportament observat in v2.7.0: data: cu JSON corupt e inghitit silent
    // (cade in catch, mesajul nu e "Eroare la incarcarea extinsa.", deci skip).
    // Stage 2a va inlocui acest catch tacut cu logging structurat — testul
    // va trebui actualizat atunci sa verifice apelul de logger, dar
    // contractul "nu blocheaza stream-ul" trebuie pastrat.
    fetchSpy.mockResolvedValue(
      makeSseResponse([
        "event: batch\ndata: {bad json\n",
        '\nevent: batch\ndata: {"data":[{"numar":"1/1/2024"}]}\n',
        '\nevent: done\ndata: {"total":1,"warnings":[]}\n\n',
      ]),
    );

    const result = await api.dosare.loadMore({} as any);
    expect(result.data).toHaveLength(1);
  });

  it("invoca onBatch pentru fiecare batch primit", async () => {
    fetchSpy.mockResolvedValue(
      makeSseResponse([
        'event: batch\ndata: {"data":[{"numar":"1"}]}\n',
        '\nevent: batch\ndata: {"data":[{"numar":"2"},{"numar":"3"}]}\n',
        '\nevent: done\ndata: {"total":3,"warnings":[]}\n\n',
      ]),
    );

    const onBatch = vi.fn();
    await api.dosare.loadMore({} as any, undefined, undefined, onBatch);
    expect(onBatch).toHaveBeenCalledTimes(2);
    expect(onBatch).toHaveBeenNthCalledWith(1, [{ numar: "1" }]);
    expect(onBatch).toHaveBeenNthCalledWith(2, [{ numar: "2" }, { numar: "3" }]);
  });
});

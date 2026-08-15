// v2.45.0: Google factureaza tokenii de thinking la tariful de output, dar
// `candidatesTokenCount` NU ii include — referinta API spune explicit
// `totalTokenCount = prompt + thoughts + candidates`. Ruta nativa citea doar
// candidatii, deci costul raportat iesea sub cel real pe toate modelele Gemini
// cu reasoning (mandatory pe 3.x Flash), nu doar pe cel nou.
//
// vi.hoisted e obligatoriu: fabricile vi.mock sunt ridicate deasupra declaratiilor.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateContentMock } = vi.hoisted(() => ({ generateContentMock: vi.fn() }));

vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: class MockGenAI {
    getGenerativeModel() {
      return { generateContent: generateContentMock };
    }
  },
}));

import { callModel } from "./ai.ts";

const KEYS = { openai: "k".repeat(20), google: "k".repeat(20) };
const NATIVE = { mode: "native" } as const;

// Citim linia structurata `ai_call`, care primeste `meta` prin spread — aceeasi
// valoare care ajunge si in `ai_usage` prin recordAiUsageSafely.
async function aiCallEntry(usageMetadata?: Record<string, number>): Promise<Record<string, unknown>> {
  generateContentMock.mockResolvedValue({
    response: {
      text: () => "Analiza completa",
      candidates: [{ finishReason: "STOP" }],
      usageMetadata,
    },
  });
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    lines.push(a.map(String).join(" "));
  });
  try {
    await callModel("gemini-flash-3.7", "prompt", KEYS, 5000, undefined, undefined, NATIVE);
  } finally {
    spy.mockRestore();
  }
  const line = lines.find((l) => l.includes('"action":"ai_call"'));
  if (!line) throw new Error("linia ai_call lipseste din stdout");
  return JSON.parse(line) as Record<string, unknown>;
}

beforeEach(() => {
  generateContentMock.mockReset();
});

describe("callGoogle — tokenii de thinking intra in output", () => {
  it("aduna thoughtsTokenCount peste candidatesTokenCount", async () => {
    const entry = await aiCallEntry({ promptTokenCount: 10, candidatesTokenCount: 20, thoughtsTokenCount: 480 });

    expect(entry.usageInput).toBe(10);
    expect(entry.usageOutput).toBe(500);
  });

  it("un raspuns fara thinking ramane raportat identic", async () => {
    const entry = await aiCallEntry({ promptTokenCount: 10, candidatesTokenCount: 20 });

    expect(entry.usageOutput).toBe(20);
  });

  it("thinking fara candidati (raspuns gol dupa gandire) tot se factureaza", async () => {
    // Cazul ostil: modelul consuma bugetul pe thinking si nu mai emite text.
    // Inainte de fix aici se raporta 0 output, deci cost 0 pe un call platit.
    const entry = await aiCallEntry({ promptTokenCount: 10, candidatesTokenCount: 0, thoughtsTokenCount: 8000 });

    expect(entry.usageOutput).toBe(8000);
  });

  it("metadata absenta ramane necunoscuta, nu zero", async () => {
    // Distinctia conteaza in ai_usage: 0 afirma "nu a produs output", absenta
    // spune "nu stim". O regresie care le confunda ar trece neobservata fara
    // testul asta, fiindca ambele produc acelasi cost calculat.
    const entry = await aiCallEntry();

    expect(entry).not.toHaveProperty("usageOutput");
    expect(entry).not.toHaveProperty("usageInput");
  });
});

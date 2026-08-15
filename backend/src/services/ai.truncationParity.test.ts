// v2.43.3 (finding review): trunchierea era detectata doar pe Anthropic nativ si pe
// OpenRouter. Pe GPT si Gemini nativ, o analiza taiata la plafonul de tokeni iesea ca
// rezultat aparent complet — acelasi dosar, acelasi model, alt verdict dupa cum era
// rutata cererea. Testele fixeaza paritatea pe cele trei cai care lipseau.
//
// vi.hoisted e obligatoriu: fabricile vi.mock sunt ridicate deasupra declaratiilor.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { responsesCreateMock, chatCreateMock, generateContentMock } = vi.hoisted(() => ({
  responsesCreateMock: vi.fn(),
  chatCreateMock: vi.fn(),
  generateContentMock: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    responses = { create: responsesCreateMock };
    chat = { completions: { create: chatCreateMock } };
  },
}));

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

function geminiResponse(text: string, finishReason: string) {
  return {
    response: {
      text: () => text,
      candidates: [{ finishReason }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
    },
  };
}

beforeEach(() => {
  responsesCreateMock.mockReset();
  chatCreateMock.mockReset();
  generateContentMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("paritate de trunchiere pe caile native", () => {
  it("OpenAI Responses: incomplete_details max_output_tokens -> AI_TRUNCATED", async () => {
    responsesCreateMock.mockResolvedValue({
      output_text: "Analiza taiata la jumatate",
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      usage: { input_tokens: 10, output_tokens: 8000 },
    });

    await expect(callModel("gpt-5.6-terra", "prompt", KEYS, 5000, undefined, undefined, NATIVE)).rejects.toMatchObject({
      code: "AI_TRUNCATED",
      stopReason: "max_output_tokens",
    });
  });

  it("OpenAI Responses: raspuns complet trece nemodificat", async () => {
    responsesCreateMock.mockResolvedValue({
      output_text: "Analiza completa",
      status: "completed",
      usage: { input_tokens: 10, output_tokens: 200 },
    });

    await expect(callModel("gpt-5.6-terra", "prompt", KEYS, 5000, undefined, undefined, NATIVE)).resolves.toBe(
      "Analiza completa"
    );
  });

  it("OpenAI fallback chat.completions: finish_reason length -> AI_TRUNCATED", async () => {
    // Responses indisponibil (404) -> fallback pe chat.completions; trunchierea de acolo
    // era cea mai usor de ratat, fiind pe a doua cale a aceleiasi functii.
    responsesCreateMock.mockRejectedValue(Object.assign(new Error("not found"), { status: 404 }));
    chatCreateMock.mockResolvedValue({
      choices: [{ message: { content: "Analiza taiata" }, finish_reason: "length" }],
      usage: { prompt_tokens: 10, completion_tokens: 8000 },
    });

    await expect(callModel("gpt-5.6-terra", "prompt", KEYS, 5000, undefined, undefined, NATIVE)).rejects.toMatchObject({
      code: "AI_TRUNCATED",
      stopReason: "length",
    });
  });

  it("Gemini: finishReason MAX_TOKENS -> AI_TRUNCATED", async () => {
    generateContentMock.mockResolvedValue(geminiResponse("Analiza taiata", "MAX_TOKENS"));

    await expect(
      callModel("gemini-flash-3.7", "prompt", KEYS, 5000, undefined, undefined, NATIVE)
    ).rejects.toMatchObject({ code: "AI_TRUNCATED", stopReason: "MAX_TOKENS" });
  });

  it("OpenAI: content_filter e tot o taiere, nu un rezultat complet", async () => {
    // Al doilea review: `reason` e optional in tipurile SDK si poate fi si "content_filter".
    // Un gate doar pe "max_output_tokens" lasa exact acelasi mod de esec pe alt trigger.
    responsesCreateMock.mockResolvedValue({
      output_text: "Analiza taiata de filtru",
      status: "incomplete",
      incomplete_details: { reason: "content_filter" },
      usage: { input_tokens: 10, output_tokens: 500 },
    });

    await expect(callModel("gpt-5.6-terra", "prompt", KEYS, 5000, undefined, undefined, NATIVE)).rejects.toMatchObject({
      code: "AI_TRUNCATED",
      stopReason: "content_filter",
      // Mesajul nu are voie sa afirme bugetul de tokeni cand cauza e alta.
      tokenBudget: false,
    });
  });

  it("OpenAI: status incomplete fara reason e tot taiere", async () => {
    responsesCreateMock.mockResolvedValue({
      output_text: "x",
      status: "incomplete",
      usage: { input_tokens: 10, output_tokens: 500 },
    });

    await expect(callModel("gpt-5.6-terra", "prompt", KEYS, 5000, undefined, undefined, NATIVE)).rejects.toMatchObject({
      code: "AI_TRUNCATED",
      stopReason: "incomplete",
    });
  });

  it("Gemini: SPII opreste generarea fara ca SDK-ul sa arunce — trebuie prins de noi", async () => {
    // badFinishReasons din @google/generative-ai contine doar SAFETY/RECITATION/LANGUAGE.
    // SPII (date personale) e cel mai plauzibil pe dosare si intoarce text partial in tacere.
    generateContentMock.mockResolvedValue(geminiResponse("Analiza taiata", "SPII"));

    await expect(
      callModel("gemini-flash-3.7", "prompt", KEYS, 5000, undefined, undefined, NATIVE)
    ).rejects.toMatchObject({ code: "AI_TRUNCATED", stopReason: "SPII", tokenBudget: false });
  });

  it("MAX_TOKENS ramane marcat ca buget de tokeni", async () => {
    generateContentMock.mockResolvedValue(geminiResponse("x", "MAX_TOKENS"));

    await expect(
      callModel("gemini-flash-3.7", "prompt", KEYS, 5000, undefined, undefined, NATIVE)
    ).rejects.toMatchObject({ tokenBudget: true });
  });

  it("Gemini: STOP normal trece nemodificat", async () => {
    generateContentMock.mockResolvedValue(geminiResponse("Analiza completa", "STOP"));

    await expect(callModel("gemini-flash-3.7", "prompt", KEYS, 5000, undefined, undefined, NATIVE)).resolves.toBe(
      "Analiza completa"
    );
  });

  it("apelul trunchiat ramane inregistrat ca succes in linia ai_call (a fost facturat)", async () => {
    responsesCreateMock.mockResolvedValue({
      output_text: "x",
      incomplete_details: { reason: "max_output_tokens" },
      usage: { input_tokens: 10, output_tokens: 8000 },
    });
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      logs.push(a.map(String).join(" "));
    });
    try {
      await expect(callModel("gpt-5.6-terra", "prompt", KEYS, 5000, undefined, undefined, NATIVE)).rejects.toThrow();
      const line = logs.find((l) => l.includes('"action":"ai_call"'));
      expect(line).toContain('"stopReason":"max_output_tokens"');
      expect(line).toContain('"status":"ok"');
    } finally {
      spy.mockRestore();
    }
  });
});

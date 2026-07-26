// Primul test pe FORMA requestului catre Anthropic. Inainte de v2.43.3 niciun fisier
// de test nu mock-uia @anthropic-ai/sdk (singurul import al SDK-ului era ai.ts:1), deci
// `max_tokens` si orice camp nou de pe calea nativa erau complet nefixate de teste.
//
// vi.hoisted e OBLIGATORIU: fabrica `vi.mock` e ridicata deasupra declaratiilor de
// modul, deci un `const streamMock = vi.fn()` simplu ar fi in TDZ cand fabrica ruleaza.
// Acelasi tipar ca in ai.openrouter.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const streamMock = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { stream: streamMock };
  },
}));

import { AI_MAX_TOKENS, callAnthropic, callModel } from "./ai.ts";

function mockFinalMessage(options?: { text?: string; stopReason?: string }) {
  return {
    finalMessage: async () => ({
      content: [{ type: "text", text: options?.text ?? "ok" }],
      usage: { input_tokens: 10, output_tokens: 20 },
      stop_reason: options?.stopReason ?? "end_turn",
    }),
  };
}

beforeEach(() => {
  streamMock.mockReset().mockReturnValue(mockFinalMessage());
});

afterEach(() => {
  vi.clearAllMocks();
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu undefined.
  delete process.env.AI_EFFORT_DISABLED;
});

describe("callAnthropic — forma requestului (v2.43.3)", () => {
  it("foloseste streaming si trimite max_tokens din constanta partajata", async () => {
    const out = await callAnthropic("k".repeat(20), "claude-opus-5", "prompt", 5000);

    expect(out).toBe("ok");
    expect(streamMock).toHaveBeenCalledTimes(1);
    const body = streamMock.mock.calls[0][0] as Record<string, unknown>;
    expect(body.max_tokens).toBe(AI_MAX_TOKENS);
    expect(body.model).toBe("claude-opus-5");
  });

  it("paseaza signal-ul compus in RequestOptions, ca la messages.create", async () => {
    await callAnthropic("k".repeat(20), "claude-opus-5", "prompt", 5000);

    const options = streamMock.mock.calls[0][1] as { signal?: AbortSignal };
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("output_config.effort DOAR pentru claude-sonnet-5 si claude-opus-5", async () => {
    for (const modelId of ["claude-sonnet-5", "claude-opus-5"]) {
      streamMock.mockClear().mockReturnValue(mockFinalMessage());
      await callAnthropic("k".repeat(20), modelId, "prompt", 5000, undefined, undefined, "medium");
      const body = streamMock.mock.calls[0][0] as Record<string, unknown>;
      expect(body.output_config).toEqual({ effort: "medium" });
    }
  });

  it("haiku 4.5 NU primeste output_config (l-ar respinge cu 400)", async () => {
    await callAnthropic("k".repeat(20), "claude-haiku-4-5-20251001", "prompt", 5000, undefined, undefined, "medium");

    const body = streamMock.mock.calls[0][0] as Record<string, unknown>;
    expect(body).not.toHaveProperty("output_config");
  });

  it("fara effort explicit nu se trimite output_config (default-ul serverului e high)", async () => {
    await callAnthropic("k".repeat(20), "claude-opus-5", "prompt", 5000);

    const body = streamMock.mock.calls[0][0] as Record<string, unknown>;
    expect(body).not.toHaveProperty("output_config");
  });

  it("AI_EFFORT_DISABLED=1 omite output_config chiar si pe un model capabil", async () => {
    process.env.AI_EFFORT_DISABLED = "1";
    await callAnthropic("k".repeat(20), "claude-opus-5", "prompt", 5000, undefined, undefined, "medium");

    const body = streamMock.mock.calls[0][0] as Record<string, unknown>;
    expect(body).not.toHaveProperty("output_config");
  });

  it("callModel propaga effort spre ruta nativa Anthropic", async () => {
    // routing native EXPLICIT: shouldRouteViaOpenRouter scurt-circuiteaza pe prima
    // linie, deci nu mai atinge DB-ul (getDecryptedKey) — fisierul asta nu are DB.
    await callModel(
      "claude-opus",
      "prompt",
      { anthropic: "k".repeat(20) },
      5000,
      undefined,
      undefined,
      { mode: "native" },
      "medium"
    );

    const body = streamMock.mock.calls[0][0] as Record<string, unknown>;
    expect(body.output_config).toEqual({ effort: "medium" });
  });

  it("stop_reason ajunge in linia de log ai_call (semnal de trunchiere)", async () => {
    streamMock.mockReset().mockReturnValue(mockFinalMessage({ stopReason: "max_tokens" }));
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      logs.push(a.map(String).join(" "));
    });
    try {
      await callAnthropic("k".repeat(20), "claude-opus-5", "prompt", 5000);
      const line = logs.find((l) => l.includes('"action":"ai_call"'));
      expect(line).toBeDefined();
      expect(line).toContain('"stopReason":"max_tokens"');
    } finally {
      spy.mockRestore();
    }
  });
});

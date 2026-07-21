import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openRouterCreateMock = vi.hoisted(() => vi.fn());
const openAiResponsesCreateMock = vi.hoisted(() => vi.fn());
const openAiConstructorMock = vi.hoisted(() => vi.fn());

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat;
    responses;

    constructor(options: unknown) {
      openAiConstructorMock(options);
      this.chat = {
        completions: {
          create: openRouterCreateMock,
        },
      };
      this.responses = {
        create: openAiResponsesCreateMock,
      };
    }
  },
}));

import { closeDb, getDb } from "../db/schema.ts";
import { invalidateCache, setTenantKey } from "../db/tenantKeysRepository.ts";
import { resetMasterKeyCacheForTests } from "../util/tenantKeyCrypto.ts";
import {
  callModel,
  callOpenAI,
  callOpenRouter,
  resolveOpenRouterSlug,
  shouldRouteViaOpenRouter,
  OPENROUTER_MODEL_MAP,
} from "./ai.ts";

let tmpRoot: string;
const originalAuthMode = process.env.LEGAL_DASHBOARD_AUTH_MODE;
const originalTenantSecret = process.env.TENANT_KEY_ENCRYPTION_SECRET;

beforeEach(async () => {
  openRouterCreateMock.mockReset();
  openAiResponsesCreateMock.mockReset();
  openAiConstructorMock.mockReset();
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-openrouter-"));
  const dbPath = path.join(tmpRoot, "legal-dashboard.db");
  process.env.LEGAL_DASHBOARD_DB_PATH = dbPath;
  const seed = new Database(dbPath);
  seed.close();
  process.env.TENANT_KEY_ENCRYPTION_SECRET = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  resetMasterKeyCacheForTests();
  getDb();
  invalidateCache();
});

afterEach(async () => {
  closeDb();
  invalidateCache();
  resetMasterKeyCacheForTests();
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.OPENROUTER_API_KEY;
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.OPENROUTER_DISABLED;
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.OPENROUTER_MODEL_OVERRIDES;
  if (originalAuthMode === undefined) {
    // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
    delete process.env.LEGAL_DASHBOARD_AUTH_MODE;
  } else {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = originalAuthMode;
  }
  if (originalTenantSecret === undefined) {
    // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
    delete process.env.TENANT_KEY_ENCRYPTION_SECRET;
  } else {
    process.env.TENANT_KEY_ENCRYPTION_SECRET = originalTenantSecret;
  }
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

function mockOpenRouterResponse(options?: { text?: string; input?: number; output?: number; cost?: number }): void {
  openRouterCreateMock.mockResolvedValue({
    choices: [{ message: { content: options?.text ?? "raspuns" } }],
    usage: {
      prompt_tokens: options?.input ?? 10,
      completion_tokens: options?.output ?? 20,
      cost: options?.cost,
    },
  });
}

describe("resolveOpenRouterSlug", () => {
  it("resolves model slugs", () => {
    expect(resolveOpenRouterSlug("claude-sonnet")).toBe(OPENROUTER_MODEL_MAP["claude-sonnet"]);
  });

  // Pin literale (NU prin OPENROUTER_MODEL_MAP, altfel testul citeste aceeasi
  // sursa pe care o citeste functia si nu ar mai prinde regresia). v2.43.x a
  // bumpuit gemini la 3.6-flash; cheile gemini-flash-3 si gemini-flash-3.5
  // au fost eliminate.
  it("pins gemini-flash-3.6 to the v2.43.x slug (regression guard)", () => {
    expect(resolveOpenRouterSlug("gemini-flash-3.6")).toBe("google/gemini-3.6-flash");
  });

  it("pins gemini-flash-lite-3.5 to the v2.43.x slug (regression guard)", () => {
    expect(resolveOpenRouterSlug("gemini-flash-lite-3.5")).toBe("google/gemini-3.5-flash-lite");
  });

  it("returns null for the retired gemini-flash-3, gemini-flash-3.5 and gemini-flash-lite-3 keys", () => {
    expect(resolveOpenRouterSlug("gemini-flash-3")).toBeNull();
    expect(resolveOpenRouterSlug("gemini-flash-3.5")).toBeNull();
    expect(resolveOpenRouterSlug("gemini-flash-lite-3")).toBeNull();
  });

  it("uses OPENROUTER_MODEL_OVERRIDES before the static map", () => {
    process.env.OPENROUTER_MODEL_OVERRIDES = "claude-sonnet:anthropic/custom";

    expect(resolveOpenRouterSlug("claude-sonnet")).toBe("anthropic/custom");
  });

  it("returns null for an unknown model", () => {
    expect(resolveOpenRouterSlug("unknown")).toBeNull();
  });

  it("ignora override-uri cu format invalid sau provider neacceptat", () => {
    process.env.OPENROUTER_MODEL_OVERRIDES =
      "claude-sonnet:javascript:alert(1), claude-opus:evil-provider/model, gpt-5.6-sol:openai/custom-gpt";
    expect(resolveOpenRouterSlug("claude-sonnet")).toBe("anthropic/claude-sonnet-5"); // fallback static
    expect(resolveOpenRouterSlug("claude-opus")).toBe("anthropic/claude-opus-4.8"); // provider respins
    expect(resolveOpenRouterSlug("gpt-5.6-sol")).toBe("openai/custom-gpt"); // valid, trece
  });

  it("ignora pair-uri malformate fara colon (defensiv)", () => {
    process.env.OPENROUTER_MODEL_OVERRIDES = "garbagewithoutcolon, claude-sonnet:anthropic/custom";
    // pair-ul fara colon e sarit, nu produce un key mangled; cel valid trece
    expect(resolveOpenRouterSlug("claude-sonnet")).toBe("anthropic/custom");
    expect(resolveOpenRouterSlug("garbagewithoutcolon")).toBeNull();
  });
});

describe("callOpenRouter", () => {
  it("calls OpenRouter through OpenAI SDK baseURL with required headers", async () => {
    mockOpenRouterResponse({ text: "ok" });

    const result = await callOpenRouter("sk-or-v1-test", "z-ai/glm-5.1", "prompt", 5000);

    expect(result).toBe("ok");
    expect(openAiConstructorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "sk-or-v1-test",
        baseURL: "https://openrouter.ai/api/v1",
        defaultHeaders: {
          "HTTP-Referer": "https://github.com/warlordro/Legal-Dashboard",
          "X-Title": "Legal Dashboard",
        },
        timeout: 5000,
      })
    );
    expect(openRouterCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "z-ai/glm-5.1",
        messages: [{ role: "user", content: "prompt" }],
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("throws immediately when OPENROUTER_DISABLED=1", async () => {
    process.env.OPENROUTER_DISABLED = "1";

    await expect(callOpenRouter("sk-or-v1-test", "z-ai/glm-5.1", "prompt", 5000)).rejects.toThrow(
      "OPENROUTER_DISABLED"
    );
    expect(openRouterCreateMock).not.toHaveBeenCalled();
  });

  it("propagates an already-aborted parent signal", async () => {
    const controller = new AbortController();
    controller.abort();
    openRouterCreateMock.mockImplementation((_body, options) => {
      expect(options.signal.aborted).toBe(true);
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    });

    await expect(
      callOpenRouter("sk-or-v1-test", "z-ai/glm-5.1", "prompt", 5000, undefined, controller.signal)
    ).rejects.toThrow("aborted");
  });

  it("persists real usage.cost as milli-USD when OpenRouter returns it", async () => {
    mockOpenRouterResponse({ input: 11, output: 22, cost: 0.456 });

    await callOpenRouter(
      "sk-or-v1-test",
      "anthropic/claude-sonnet-5",
      "prompt",
      5000,
      { ownerId: "alice", feature: "dosar_summary", requestId: "req-cost" },
      undefined,
      "openrouter:western"
    );
    await Promise.resolve();
    await Promise.resolve();

    const row = getDb().prepare("SELECT cost_usd_milli, routing_tag FROM ai_usage").get() as {
      cost_usd_milli: number;
      routing_tag: string | null;
    };
    expect(row).toEqual({ cost_usd_milli: 456, routing_tag: "openrouter:western" });
  });

  it("falls back to MODEL_PRICES when usage.cost is missing", async () => {
    mockOpenRouterResponse({ input: 1_000_000, output: 0 });

    await callOpenRouter(
      "sk-or-v1-test",
      "anthropic/claude-sonnet-5",
      "prompt",
      5000,
      { ownerId: "alice", feature: "dosar_summary" },
      undefined,
      "openrouter:western"
    );
    await Promise.resolve();
    await Promise.resolve();

    const row = getDb().prepare("SELECT cost_usd_milli FROM ai_usage").get() as { cost_usd_milli: number };
    expect(row.cost_usd_milli).toBe(3000);
  });
});

describe("callOpenAI — Responses API fallback (audit R3)", () => {
  it("falls back to chat.completions when responses.create rejects with 404", async () => {
    openAiResponsesCreateMock.mockRejectedValue(Object.assign(new Error("not found"), { status: 404 }));
    openRouterCreateMock.mockResolvedValue({
      choices: [{ message: { content: "fallback content" } }],
      usage: { prompt_tokens: 12, completion_tokens: 34 },
    });

    const result = await callOpenAI("sk-openai-test", "gpt-5.4", "prompt", 5000);

    expect(result).toBe("fallback content");
    expect(openAiResponsesCreateMock).toHaveBeenCalledTimes(1);
    expect(openRouterCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5.4",
        messages: [{ role: "user", content: "prompt" }],
        max_completion_tokens: 8000,
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("does NOT fall back on an auth error (401 propagates, chat.completions never called)", async () => {
    openAiResponsesCreateMock.mockRejectedValue(Object.assign(new Error("unauthorized"), { status: 401 }));

    await expect(callOpenAI("sk-openai-test", "gpt-5.4", "prompt", 5000)).rejects.toThrow("unauthorized");
    expect(openRouterCreateMock).not.toHaveBeenCalled();
  });

  it("does NOT fall back when the signal is already aborted (propagates, chat.completions never called)", async () => {
    const controller = new AbortController();
    controller.abort();
    openAiResponsesCreateMock.mockImplementation(() => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    });

    await expect(callOpenAI("sk-openai-test", "gpt-5.4", "prompt", 5000, undefined, controller.signal)).rejects.toThrow(
      "aborted"
    );
    expect(openRouterCreateMock).not.toHaveBeenCalled();
  });

  it("does NOT fall back when the INTERNAL timeout fires even if the error mentions 'responses'", async () => {
    // timeout=0 → composed (AbortSignal.any incl. the internal timeout) aborts on
    // the next tick; the mock then rejects with a NON-abort error whose message
    // contains "responses" — the substring that would otherwise trigger fallback.
    // The re-throw must key off composed.aborted, not just signal?.aborted.
    openAiResponsesCreateMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      throw new Error("the /responses request did not complete");
    });

    await expect(callOpenAI("sk-openai-test", "gpt-5.4", "prompt", 0)).rejects.toThrow(/responses/);
    expect(openRouterCreateMock).not.toHaveBeenCalled();
  });
});

describe("callModel OpenRouter routing", () => {
  it("uses OPENROUTER_API_KEY env as implicit OpenRouter override", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-env";
    mockOpenRouterResponse();

    await callModel("claude-sonnet", "prompt", {}, 5000);

    expect(openAiConstructorMock).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "sk-or-v1-env" }));
    expect(openRouterCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "anthropic/claude-sonnet-5" }),
      expect.any(Object)
    );
  });

  it("uses a sk-or body key as OpenRouter override in desktop mode", async () => {
    mockOpenRouterResponse();

    await callModel("gpt-5.6-terra", "prompt", { openrouter: "sk-or-v1-body" }, 5000);

    expect(openAiConstructorMock).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "sk-or-v1-body" }));
    expect(openRouterCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "openai/gpt-5.6-terra" }),
      expect.any(Object)
    );
  });

  it("uses tenant DB OpenRouter key in web mode", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    setTenantKey("openrouter", "sk-or-v1-tenant", "admin");
    mockOpenRouterResponse();

    await callModel("claude-sonnet", "prompt", {}, 5000);

    expect(openAiConstructorMock).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "sk-or-v1-tenant" }));
    expect(openRouterCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "anthropic/claude-sonnet-5" }),
      expect.any(Object)
    );
  });

  it("throws NO_API_KEY:openrouter when OpenRouter is selected without a key", async () => {
    await expect(
      callModel("claude-sonnet", "prompt", {}, 5000, undefined, undefined, { mode: "openrouter" })
    ).rejects.toThrow("NO_API_KEY:openrouter");
  });
});

describe("shouldRouteViaOpenRouter", () => {
  it("routes when mode is explicitly openrouter", () => {
    expect(shouldRouteViaOpenRouter({ anthropic: "sk-ant" }, { mode: "openrouter" })).toBe(true);
  });

  it("does NOT route to openrouter when mode is native, even with a saved sk-or-* body key", () => {
    // Repro: user toggles back to native mode while keeping the OpenRouter key in
    // settings. routing.mode === "native" must win over the auto-detect on the
    // saved sk-or-* key.
    expect(shouldRouteViaOpenRouter({ anthropic: "sk-ant", openrouter: "sk-or-v1-test" }, { mode: "native" })).toBe(
      false
    );
  });

  it("does NOT route to openrouter when mode is native, even with OPENROUTER_API_KEY env set", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-env";
    expect(shouldRouteViaOpenRouter({ openai: "sk-test" }, { mode: "native" })).toBe(false);
  });

  it("auto-detects openrouter when routing is undefined and a sk-or-* body key is present", () => {
    expect(shouldRouteViaOpenRouter({ openrouter: "sk-or-v1-test" }, undefined)).toBe(true);
  });

  it("auto-detects openrouter when routing is undefined and OPENROUTER_API_KEY env is set", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-env";
    expect(shouldRouteViaOpenRouter({}, undefined)).toBe(true);
  });
});

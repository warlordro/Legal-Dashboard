import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openRouterCreateMock = vi.hoisted(() => vi.fn());
const openAiConstructorMock = vi.hoisted(() => vi.fn());

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat;

    constructor(options: unknown) {
      openAiConstructorMock(options);
      this.chat = {
        completions: {
          create: openRouterCreateMock,
        },
      };
    }
  },
}));

import { closeDb, getDb } from "../db/schema.ts";
import { invalidateCache, setTenantKey } from "../db/tenantKeysRepository.ts";
import { resetMasterKeyCacheForTests } from "../util/tenantKeyCrypto.ts";
import {
  callModel,
  callOpenRouter,
  resolveOpenRouterSlug,
  shouldRouteViaOpenRouter,
  OPENROUTER_CHINESE_MAP,
  OPENROUTER_WESTERN_MAP,
} from "./ai.ts";

let tmpRoot: string;
const originalAuthMode = process.env.LEGAL_DASHBOARD_AUTH_MODE;
const originalTenantSecret = process.env.TENANT_KEY_ENCRYPTION_SECRET;

beforeEach(async () => {
  openRouterCreateMock.mockReset();
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
  it("resolves western stack slugs", () => {
    expect(resolveOpenRouterSlug("claude-sonnet", "western")).toBe(OPENROUTER_WESTERN_MAP["claude-sonnet"]);
  });

  it("resolves chinese stack slugs", () => {
    expect(resolveOpenRouterSlug("qwen-3.7-max", "chinese")).toBe(OPENROUTER_CHINESE_MAP["qwen-3.7-max"]);
  });

  it("uses OPENROUTER_MODEL_OVERRIDES before the static maps", () => {
    process.env.OPENROUTER_MODEL_OVERRIDES = "qwen-3.7-max:qwen/custom, claude-sonnet:anthropic/custom";

    expect(resolveOpenRouterSlug("qwen-3.7-max", "chinese")).toBe("qwen/custom");
    expect(resolveOpenRouterSlug("claude-sonnet", "western")).toBe("anthropic/custom");
  });

  it("returns null for a model outside the selected stack", () => {
    expect(resolveOpenRouterSlug("qwen-3.7-max", "western")).toBeNull();
    expect(resolveOpenRouterSlug("unknown", "chinese")).toBeNull();
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
      "qwen/qwen3.7-max",
      "prompt",
      5000,
      { ownerId: "alice", feature: "dosar_summary", requestId: "req-cost" },
      undefined,
      "openrouter:chinese"
    );
    await Promise.resolve();
    await Promise.resolve();

    const row = getDb().prepare("SELECT cost_usd_milli, routing_tag FROM ai_usage").get() as {
      cost_usd_milli: number;
      routing_tag: string | null;
    };
    expect(row).toEqual({ cost_usd_milli: 456, routing_tag: "openrouter:chinese" });
  });

  it("falls back to MODEL_PRICES when usage.cost is missing", async () => {
    mockOpenRouterResponse({ input: 1_000_000, output: 0 });

    await callOpenRouter(
      "sk-or-v1-test",
      "z-ai/glm-5.1",
      "prompt",
      5000,
      { ownerId: "alice", feature: "dosar_summary" },
      undefined,
      "openrouter:chinese"
    );
    await Promise.resolve();
    await Promise.resolve();

    const row = getDb().prepare("SELECT cost_usd_milli FROM ai_usage").get() as { cost_usd_milli: number };
    expect(row.cost_usd_milli).toBe(980);
  });
});

describe("callModel OpenRouter routing", () => {
  it("uses explicit openrouter routing with selected stack", async () => {
    mockOpenRouterResponse({ text: "via openrouter" });

    const result = await callModel(
      "qwen-3.7-max",
      "prompt",
      { openrouter: "sk-or-v1-test" },
      5000,
      undefined,
      undefined,
      { mode: "openrouter", stack: "chinese" }
    );

    expect(result).toBe("via openrouter");
    expect(openRouterCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "qwen/qwen3.7-max" }),
      expect.any(Object)
    );
  });

  it("uses OPENROUTER_API_KEY env as implicit OpenRouter override", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-env";
    mockOpenRouterResponse();

    await callModel("claude-sonnet", "prompt", {}, 5000);

    expect(openAiConstructorMock).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "sk-or-v1-env" }));
    expect(openRouterCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "anthropic/claude-sonnet-4.6" }),
      expect.any(Object)
    );
  });

  it("uses a sk-or body key as OpenRouter override in desktop mode", async () => {
    mockOpenRouterResponse();

    await callModel("gpt-5.4-mini", "prompt", { openrouter: "sk-or-v1-body" }, 5000);

    expect(openAiConstructorMock).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "sk-or-v1-body" }));
    expect(openRouterCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "openai/gpt-5.4-mini" }),
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
      expect.objectContaining({ model: "anthropic/claude-sonnet-4.6" }),
      expect.any(Object)
    );
  });

  it("throws NO_API_KEY:openrouter when OpenRouter is selected without a key", async () => {
    await expect(
      callModel("glm-5.1", "prompt", {}, 5000, undefined, undefined, { mode: "openrouter", stack: "chinese" })
    ).rejects.toThrow("NO_API_KEY:openrouter");
  });

  it("throws MODEL_NOT_IN_STACK when selected model is outside the OpenRouter stack", async () => {
    await expect(
      callModel("qwen-3.7-max", "prompt", { openrouter: "sk-or-v1-test" }, 5000, undefined, undefined, {
        mode: "openrouter",
        stack: "western",
      })
    ).rejects.toThrow("MODEL_NOT_IN_STACK:qwen-3.7-max:western");
  });
});

describe("shouldRouteViaOpenRouter", () => {
  it("routes when mode is explicitly openrouter", () => {
    expect(
      shouldRouteViaOpenRouter("claude-sonnet", { anthropic: "sk-ant" }, { mode: "openrouter", stack: "western" })
    ).toBe(true);
  });

  it("does NOT route to openrouter when mode is native, even with a saved sk-or-* body key", () => {
    // Repro: user toggles back to native mode while keeping the OpenRouter key in
    // settings. routing.mode === "native" must win over the auto-detect on the
    // saved sk-or-* key.
    expect(
      shouldRouteViaOpenRouter(
        "claude-sonnet",
        { anthropic: "sk-ant", openrouter: "sk-or-v1-test" },
        { mode: "native", stack: "chinese" }
      )
    ).toBe(false);
  });

  it("does NOT route to openrouter when mode is native, even with OPENROUTER_API_KEY env set", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-env";
    expect(shouldRouteViaOpenRouter("gpt-5.4-mini", { openai: "sk-test" }, { mode: "native", stack: "western" })).toBe(
      false
    );
  });

  it("still routes to openrouter in native mode for openrouter-only models (defensive fallback)", () => {
    // The UI filter prevents picking a chinese-only model in native mode, but if it
    // somehow happens we route to OpenRouter rather than failing — there is no
    // native SDK for these models.
    expect(
      shouldRouteViaOpenRouter("qwen-3.7-max", { openrouter: "sk-or-v1-test" }, { mode: "native", stack: "chinese" })
    ).toBe(true);
  });

  it("auto-detects openrouter when routing is undefined and a sk-or-* body key is present", () => {
    expect(shouldRouteViaOpenRouter("claude-sonnet", { openrouter: "sk-or-v1-test" }, undefined)).toBe(true);
  });

  it("auto-detects openrouter when routing is undefined and OPENROUTER_API_KEY env is set", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-env";
    expect(shouldRouteViaOpenRouter("claude-sonnet", {}, undefined)).toBe(true);
  });
});

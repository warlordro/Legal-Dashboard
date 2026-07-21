import { describe, expect, it } from "vitest";
import { AI_MODELS, JUDGE_MODELS_LIST } from "./dosare-ai-config";

describe("dosare-ai-config AI_MODELS", () => {
  it("lists 9 western models", () => {
    expect(AI_MODELS).toHaveLength(9);
  });

  it("drops the chinese keys", () => {
    const keys = AI_MODELS.map((model) => model.key);
    expect(keys).not.toContain("glm-5.1");
    expect(keys).not.toContain("kimi-k2.6");
    expect(keys).not.toContain("qwen-3.7-max");
  });

  it("uses the refreshed Opus 4.8 and 3.6 Flash labels", () => {
    expect(AI_MODELS.find((model) => model.key === "claude-opus")?.label).toBe("Opus 4.8");
    expect(AI_MODELS.find((model) => model.key === "gemini-flash-3.6")?.label).toBe("3.6 Flash");
    expect(AI_MODELS.map((model) => model.key)).not.toContain("gemini-flash-3.5");
  });

  // v2.42.x: familia OpenAI trece pe GPT-5.6 — Sol (premium), Terra
  // (echilibrat), Luna (rapid). Cheile 5.4 dispar din catalog.
  it("familia OpenAI e GPT-5.6 Sol/Terra/Luna, fara chei 5.4", () => {
    const keys = AI_MODELS.map((model) => model.key);
    expect(keys).toEqual(expect.arrayContaining(["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]));
    expect(keys.some((k) => k.startsWith("gpt-5.4"))).toBe(false);
    expect(AI_MODELS.find((m) => m.key === "gpt-5.6-sol")?.label).toBe("GPT-5.6 Sol");
    expect(AI_MODELS.find((m) => m.key === "gpt-5.6-terra")?.label).toBe("5.6 Terra");
    expect(AI_MODELS.find((m) => m.key === "gpt-5.6-luna")?.label).toBe("5.6 Luna");
    expect(AI_MODELS.find((m) => m.key === "gpt-5.6-sol")?.desc).toBe("Premium");
    expect(AI_MODELS.find((m) => m.key === "gpt-5.6-terra")?.desc).toBe("Echilibrat");
    expect(AI_MODELS.find((m) => m.key === "gpt-5.6-luna")?.desc).toBe("Rapid");
  });
});

describe("dosare-ai-config JUDGE_MODELS_LIST", () => {
  it("lists the 3 western judges", () => {
    expect(JUDGE_MODELS_LIST.map((model) => model.key)).toEqual(["claude-opus", "gpt-5.6-sol", "gemini-pro-3"]);
  });

  it("labels the Claude judge Opus 4.8", () => {
    expect(JUDGE_MODELS_LIST.find((model) => model.key === "claude-opus")?.label).toBe("Claude Opus 4.8");
  });
});

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

  it("uses the refreshed Opus 4.8 and 3.5 Flash labels", () => {
    expect(AI_MODELS.find((model) => model.key === "claude-opus")?.label).toBe("Opus 4.8");
    expect(AI_MODELS.find((model) => model.key === "gemini-flash-3.5")?.label).toBe("3.5 Flash");
  });
});

describe("dosare-ai-config JUDGE_MODELS_LIST", () => {
  it("lists the 3 western judges", () => {
    expect(JUDGE_MODELS_LIST.map((model) => model.key)).toEqual(["claude-opus", "gpt-5.4", "gemini-pro-3"]);
  });

  it("labels the Claude judge Opus 4.8", () => {
    expect(JUDGE_MODELS_LIST.find((model) => model.key === "claude-opus")?.label).toBe("Claude Opus 4.8");
  });
});

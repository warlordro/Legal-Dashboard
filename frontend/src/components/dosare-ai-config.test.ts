import { describe, expect, it } from "vitest";
import { availableJudgeModels, availableModels } from "./dosare-ai-config";

describe("dosare-ai-config availableModels", () => {
  it("returns 9 western models in native mode", () => {
    expect(availableModels("native", "western").map((model) => model.key)).toHaveLength(9);
  });

  it("returns the same 9 western models for openrouter western", () => {
    expect(availableModels("openrouter", "western").map((model) => model.key)).toEqual(
      availableModels("native", "western").map((model) => model.key)
    );
  });

  it("returns 3 chinese models for openrouter chinese", () => {
    expect(availableModels("openrouter", "chinese").map((model) => model.key)).toEqual([
      "glm-5.1",
      "kimi-k2.6",
      "qwen-3.7-max",
    ]);
  });

  it("filters judge models per stack", () => {
    expect(availableJudgeModels("native", "western").map((model) => model.key)).toEqual([
      "claude-opus",
      "gpt-5.4",
      "gemini-pro-3",
    ]);
    expect(availableJudgeModels("openrouter", "chinese").map((model) => model.key)).toEqual([
      "glm-5.1",
      "kimi-k2.6",
      "qwen-3.7-max",
    ]);
  });
});

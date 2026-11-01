import { describe, expect, it } from "vitest";
import { DEFAULT_ENGINE_SETTINGS } from "../domain/engine-settings.js";
import { EngineSettingsForTests } from "../ports/engine-settings-repository.fixtures.js";
import { ModelPrices } from "./model-prices.js";

const prices = new ModelPrices(
  new EngineSettingsForTests({
    ...DEFAULT_ENGINE_SETTINGS,
    modelPrices: [
      {
        engineId: "claude-code",
        model: "claude-sonnet-5-5",
        price: { input: 3, output: 15, cacheWrites: 3.75, cacheReads: 0.3 },
      },
    ],
  }),
);

describe("ModelPrices", () => {
  it("prices each kind of token by its own price per million", async () => {
    const tokens = {
      input: 2_000_000,
      output: 100_000,
      cacheCreation: 400_000,
      cacheRead: 10_000_000,
    };

    // 2 × $3 + 0.1 × $15 + 0.4 × $3.75 + 10 × $0.30
    expect(await prices.costOf("claude-code", "claude-sonnet-5-5", tokens)).toBeCloseTo(12);
  });

  it("gives no cost for a model with no price, or priced on another engine id", async () => {
    const tokens = { input: 1, output: 1, cacheCreation: 1, cacheRead: 1 };

    expect(await prices.costOf("claude-code", "claude-opus-5-5", tokens)).toBeUndefined();
    expect(
      await prices.costOf("openai-compatible-api", "claude-sonnet-5-5", tokens),
    ).toBeUndefined();
  });
});

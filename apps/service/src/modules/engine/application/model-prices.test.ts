import { describe, expect, it } from "vitest";
import { DEFAULT_ENGINE_SETTINGS } from "../domain/engine-settings.js";
import type { ApiEngine } from "../domain/engines.js";
import { EngineSettingsForTests } from "../ports/engine-settings-repository.fixtures.js";
import { ModelPrices } from "./model-prices.js";

const SONNET_PRICE = { input: 3, output: 15, cacheWrites: 3.75, cacheReads: 0.3 };
const CODER_PRICE = { input: 1, output: 2, cacheWrites: 0, cacheReads: 0 };

const lab: ApiEngine = {
  id: "lab",
  name: "Lab",
  kind: "openai-compatible-api",
  defaultModel: "coder",
  baseUrl: "http://lab",
  key: "",
  models: [{ id: "coder", contextWindow: 32_000 }],
};

const prices = new ModelPrices(
  new EngineSettingsForTests({
    ...DEFAULT_ENGINE_SETTINGS,
    engines: [...DEFAULT_ENGINE_SETTINGS.engines, lab],
    modelPrices: [
      { engineId: null, model: "claude-sonnet-5-5", price: SONNET_PRICE },
      { engineId: "lab", model: "coder", price: CODER_PRICE },
      { engineId: "removed", model: "coder", price: CODER_PRICE },
    ],
  }),
);

const tokens = { input: 1_000_000, output: 1_000_000, cacheCreation: 0, cacheRead: 0 };

describe("ModelPrices", () => {
  it("prices each kind of token by its own price per million", async () => {
    const mixed = {
      input: 2_000_000,
      output: 100_000,
      cacheCreation: 400_000,
      cacheRead: 10_000_000,
    };

    // 2 × $3 + 0.1 × $15 + 0.4 × $3.75 + 10 × $0.30
    expect(
      await prices.costOf({ engineId: "claude-code", model: "claude-sonnet-5-5" }, mixed),
    ).toBeCloseTo(12);
  });

  it("prices a Claude model alike on every Claude Code engine, a removed one's included", async () => {
    expect(
      await prices.costOf({ engineId: "second-account", model: "claude-sonnet-5-5" }, tokens),
    ).toBeCloseTo(18);
  });

  it("prices an API model by its own engine's price, a removed engine's kept", async () => {
    expect(await prices.costOf({ engineId: "lab", model: "coder" }, tokens)).toBeCloseTo(3);
    expect(await prices.costOf({ engineId: "removed", model: "coder" }, tokens)).toBeCloseTo(3);
  });

  it("gives no cost for a model with no price, or a Claude model on an API engine", async () => {
    expect(
      await prices.costOf({ engineId: "claude-code", model: "claude-opus-5-5" }, tokens),
    ).toBeUndefined();
    expect(
      await prices.costOf({ engineId: "lab", model: "claude-sonnet-5-5" }, tokens),
    ).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { DEFAULT_ENGINE_SETTINGS } from "../domain/engine-settings.js";
import type { ApiEngine, CodexEngine } from "../domain/engines.js";
import { EngineSettingsForTests } from "../ports/engine-settings-repository.fixtures.js";
import { ModelPrices } from "./model-prices.js";

const SONNET_PRICE = { input: 3, output: 15, cacheWrites: 3.75, cacheReads: 0.3 };
const CODER_PRICE = { input: 1, output: 2, cacheWrites: 0, cacheReads: 0 };
const LUNA_PRICE = { input: 2, output: 8, cacheWrites: 0, cacheReads: 0.5 };

const lab: ApiEngine = {
  id: "lab",
  name: "Lab",
  kind: "openai-compatible-api",
  defaultModel: "coder",
  defaultEffort: null,
  baseUrl: "http://lab",
  key: "",
  models: [{ id: "coder", contextWindow: 32_000 }],
};

const codex: CodexEngine = {
  id: "codex",
  name: "Codex",
  kind: "codex",
  defaultModel: "gpt-6-luna",
  defaultEffort: null,
  apiKey: null,
};

const prices = new ModelPrices(
  new EngineSettingsForTests({
    ...DEFAULT_ENGINE_SETTINGS,
    engines: [...DEFAULT_ENGINE_SETTINGS.engines, lab, codex],
    modelPrices: [
      { engineId: null, model: "claude-sonnet-5-5", price: SONNET_PRICE },
      { engineId: null, model: "gpt-6-luna", price: LUNA_PRICE },
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

  it("prices a Codex model by its one price on every Codex engine, a removed one's included", async () => {
    // $2 + $8
    expect(await prices.costOf({ engineId: "codex", model: "gpt-6-luna" }, tokens)).toBeCloseTo(10);
    expect(
      await prices.costOf({ engineId: "removed-codex", model: "gpt-6-luna" }, tokens),
    ).toBeCloseTo(10);
    expect(
      await prices.costOf({ engineId: "codex", model: "gpt-5.6-terra" }, tokens),
    ).toBeUndefined();
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

  it("reads a removed engine with prices of its own kept as an API engine", async () => {
    expect(
      await prices.costOf({ engineId: "removed", model: "claude-sonnet-5-5" }, tokens),
    ).toBeUndefined();
  });
});

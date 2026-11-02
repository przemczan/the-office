import { Injectable } from "@nestjs/common";
import type { EngineModel } from "../domain/engines.js";
import { priceOf, type ModelPrice } from "../domain/model-prices.js";
import { EngineSettingsRepository } from "../ports/engine-settings-repository.js";
import type { TokenUsage } from "../ports/session-events.js";

const TOKENS_PER_PRICE = 1_000_000;

/** What tokens cost by the Model prices of Settings › Engines (spec §5.4), on every engine. */
@Injectable()
export class ModelPrices {
  constructor(private readonly settings: EngineSettingsRepository) {}

  /** The dollars `tokens` cost on an engine's model; undefined when the model has no price. */
  async costOf(spentOn: EngineModel, tokens: TokenUsage): Promise<number | undefined> {
    const { modelPrices, engines } = await this.settings.read();
    const price = priceOf(modelPrices, engines, spentOn);
    return price && cost(price, tokens);
  }
}

function cost(price: ModelPrice, tokens: TokenUsage): number {
  const dollars =
    tokens.input * price.input +
    tokens.output * price.output +
    tokens.cacheCreation * price.cacheWrites +
    tokens.cacheRead * price.cacheReads;
  return dollars / TOKENS_PER_PRICE;
}

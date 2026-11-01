import { Injectable } from "@nestjs/common";
import type { EngineId } from "../domain/engines.js";
import type { ModelPrice } from "../domain/model-prices.js";
import { EngineSettingsRepository } from "../ports/engine-settings-repository.js";
import type { TokenUsage } from "../ports/session-events.js";

const TOKENS_PER_PRICE = 1_000_000;

/** What tokens cost by the Model prices of Settings › Engines (spec §5.4), on every engine. */
@Injectable()
export class ModelPrices {
  constructor(private readonly settings: EngineSettingsRepository) {}

  /** The dollars `tokens` on `model` cost on `engineId`; undefined when the model has no price. */
  async costOf(engineId: EngineId, model: string, tokens: TokenUsage): Promise<number | undefined> {
    const { modelPrices } = await this.settings.read();
    const priced = modelPrices.find((each) => each.engineId === engineId && each.model === model);
    return priced && cost(priced.price, tokens);
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

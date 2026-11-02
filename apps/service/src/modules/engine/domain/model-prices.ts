import type { Engine, EngineModel, EngineId } from "./engines.js";

/** What a model costs, in dollars per million tokens of each kind (spec §5.4). */
export interface ModelPrice {
  readonly input: number;
  readonly output: number;
  readonly cacheWrites: number;
  readonly cacheReads: number;
}

/**
 * A model with its Model price (spec §5.4): a Claude model has one price on every Claude Code
 * engine, its `engineId` null; an API engine's model has its own, by the engine's id and the
 * model's id there. A removed engine's prices are kept, so its history stays priced.
 */
export interface PricedModel {
  readonly engineId: EngineId | null;
  readonly model: string;
  readonly price: ModelPrice;
}

/** A model as Settings › Engines lists and saves it, with its Model price or none. */
export interface OfferedModel {
  readonly engineId: EngineId | null;
  readonly model: string;
  readonly price: ModelPrice | null;
}

/** The models offered under a price's `engineId`, which only may be priced. */
export type OfferedOn = (engineId: EngineId | null) => readonly string[];

/**
 * The priced models `edits` keep: those without a price or no longer offered are dropped. Adds a
 * reason to `problems` for a model given twice or a price that isn't a sum of dollars.
 */
export function pricedModels(
  edits: readonly OfferedModel[],
  offeredOn: OfferedOn,
  problems: string[],
): PricedModel[] {
  const seen = new Set<string>();
  const priced: PricedModel[] = [];
  for (const { engineId, model, price } of edits) {
    const key = JSON.stringify([engineId, model]);
    if (seen.has(key)) problems.push(`The model "${model}" is priced twice.`);
    seen.add(key);
    if (price === null || !offeredOn(engineId).includes(model)) continue;
    if (!isPrice(price)) {
      problems.push(`Give "${model}" prices of zero or more dollars per million tokens.`);
    }
    priced.push({ engineId, model, price: { ...price } });
  }
  return priced;
}

function isPrice({ input, output, cacheWrites, cacheReads }: ModelPrice): boolean {
  return [input, output, cacheWrites, cacheReads].every(
    (dollars) => Number.isFinite(dollars) && dollars >= 0,
  );
}

/**
 * The Model price of `model` on `engineId`: the API engine's own, or else the Claude model's when
 * the engine is no API engine. `engines` are those listed now; a removed one is priced by what is
 * kept of it.
 */
export function priceOf(
  prices: readonly PricedModel[],
  engines: readonly Engine[],
  { engineId, model }: EngineModel,
): ModelPrice | undefined {
  const own = prices.find((each) => each.engineId === engineId && each.model === model);
  if (own) return own.price;
  const engine = engines.find(({ id }) => id === engineId);
  if (engine?.kind === "openai-compatible-api") return undefined;
  return prices.find((each) => each.engineId === null && each.model === model)?.price;
}

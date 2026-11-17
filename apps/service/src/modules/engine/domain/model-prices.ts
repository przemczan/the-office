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
 * engine and a Codex model one on every Codex engine, its `engineId` null; an API engine's model
 * has its own, by the engine's id and the model's id there. A removed engine's prices are kept, so
 * its history stays priced.
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
    const key = priceKeyOf({ engineId, model });
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

/**
 * The stored prices kept beside what an edit prices, so a removed engine's history stays priced
 * (spec §5.4): those whose engine is no longer listed (no Claude Code engine, for a Claude model's;
 * no Codex engine, for a Codex model's), and those already kept, until the edit prices that model
 * again, as when an engine added back under its name takes its id back. `offeredBefore` gives the
 * stored engines' models, `offeredNow` the edited ones'.
 */
export function keptModelPrices(
  stored: readonly PricedModel[],
  edited: readonly PricedModel[],
  offeredBefore: OfferedOn,
  offeredNow: OfferedOn,
): PricedModel[] {
  const editedKeys = new Set(edited.map(priceKeyOf));
  return stored.filter(
    (each) =>
      !editedKeys.has(priceKeyOf(each)) &&
      (offeredNow(each.engineId).length === 0 ||
        // A shared price stays while its model isn't offered now, as with the last Codex engine
        // removed beside a Claude Code engine.
        (each.engineId === null && !offeredNow(null).includes(each.model)) ||
        !offeredBefore(each.engineId).includes(each.model)),
  );
}

function priceKeyOf({ engineId, model }: Pick<PricedModel, "engineId" | "model">): string {
  return JSON.stringify([engineId, model]);
}

function isPrice({ input, output, cacheWrites, cacheReads }: ModelPrice): boolean {
  return [input, output, cacheWrites, cacheReads].every(
    (dollars) => Number.isFinite(dollars) && dollars >= 0,
  );
}

/**
 * The Model price of `model` on `engineId`: the API engine's own, or else the shared one of the
 * Claude or Codex model (`engineId` null) when the engine is no API engine. `engines` are those
 * listed now; a removed one is priced by what is kept of it, an API engine when prices of its own
 * are kept.
 */
export function priceOf(
  prices: readonly PricedModel[],
  engines: readonly Engine[],
  { engineId, model }: EngineModel,
): ModelPrice | undefined {
  const own = prices.find((each) => each.engineId === engineId && each.model === model);
  if (own) return own.price;
  const engine = engines.find(({ id }) => id === engineId);
  // The Claude and Codex models share a price across engines; an API engine's are its own.
  if (engine?.kind === "openai-compatible-api") return undefined;
  if (engine === undefined && prices.some((each) => each.engineId === engineId)) return undefined;
  return prices.find((each) => each.engineId === null && each.model === model)?.price;
}

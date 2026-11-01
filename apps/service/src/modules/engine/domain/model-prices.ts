import type { EngineId } from "./engines.js";

/** What a model costs, in dollars per million tokens of each kind (spec §5.4). */
export interface ModelPrice {
  readonly input: number;
  readonly output: number;
  readonly cacheWrites: number;
  readonly cacheReads: number;
}

/**
 * A model with its Model price, keyed by the engine id it is spent on and the model as the Model
 * field names it: one Claude model has one price on both Claude Code engines.
 */
export interface PricedModel {
  readonly engineId: EngineId;
  readonly model: string;
  readonly price: ModelPrice;
}

/** A model as Settings › Engines lists and saves it, with its Model price or none. */
export interface OfferedModel {
  readonly engineId: EngineId;
  readonly model: string;
  readonly price: ModelPrice | null;
}

/** The models offered on an engine id, which only may be priced. */
export type OfferedOn = (engineId: EngineId) => readonly string[];

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

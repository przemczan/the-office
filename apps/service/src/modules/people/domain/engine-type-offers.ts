import {
  effortsTakenBy,
  ENGINE_TYPE_NAMES,
  offeredModels,
  type Engine,
  type EngineKind,
} from "../../engine/index.domain.js";
import type { Effort, EngineTypesOffered } from "./role-card.js";

/** Every engine type, in the order the user reads them. */
export const ENGINE_TYPES = Object.keys(ENGINE_TYPE_NAMES) as readonly EngineKind[];

/** What the Role card offers on one engine type (spec §5.4.5, "Models and efforts of an engine type"). */
export interface EngineTypeOption {
  readonly type: EngineKind;
  /** Whether Settings › Engines lists an engine of the type. */
  readonly listed: boolean;
  /** The models its listed engines offer together, each telling whether all of them offer it. */
  readonly models: readonly { readonly model: string; readonly onEveryAccount: boolean }[];
  /** The efforts the type takes, in its order. */
  readonly efforts: readonly Effort[];
}

/**
 * Every engine type with what the card offers on it, from the engines listed now: the types in the
 * order of their first engine there, then the types none lists, which offer no model yet.
 */
export function engineTypeOptions(engines: readonly Engine[]): EngineTypeOption[] {
  const listedTypes = [...new Set(engines.map((engine) => engine.kind))];
  const unlisted = ENGINE_TYPES.filter((type) => !listedTypes.includes(type));
  return [...listedTypes, ...unlisted].map((type) => {
    const ofType = engines.filter((engine) => engine.kind === type);
    const offers = ofType.map((engine) => offeredModels(engine));
    const models = [...new Set(offers.flat())].map((model) => ({
      model,
      onEveryAccount: offers.every((offered) => offered.includes(model)),
    }));
    return { type, listed: ofType.length > 0, models, efforts: effortsTakenBy(type) };
  });
}

/** The lookup a card is checked against, from the same engines as `engineTypeOptions`. */
export function engineTypesOffered(engines: readonly Engine[]): EngineTypesOffered {
  const options = new Map(engineTypeOptions(engines).map((option) => [option.type, option]));
  return (type) => {
    const option = options.get(type);
    return {
      listed: option?.listed ?? false,
      models: option?.models.map(({ model }) => model) ?? [],
      efforts: option?.efforts ?? effortsTakenBy(type),
    };
  };
}

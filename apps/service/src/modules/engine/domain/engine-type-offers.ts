import {
  effortsTakenBy,
  ENGINE_TYPE_NAMES,
  offeredModels,
  type Effort,
  type Engine,
  type EngineKind,
} from "./engines.js";

/** What an engine type offers among the engines listed now: their models together, its efforts. */
export type EngineTypeOffers = (type: EngineKind) => {
  readonly models: readonly string[];
  readonly efforts: readonly Effort[];
};

/** A model and an effort set for an engine type, each null for the level below. */
export interface ModelAndEffortSetting {
  readonly model: string | null;
  readonly effort: Effort | null;
}

/** The lookup of what each engine type offers among `engines`, as the Role card's. */
export function engineTypeOffersOf(engines: readonly Engine[]): EngineTypeOffers {
  return (type) => ({
    models: [
      ...new Set(
        engines.filter(({ kind }) => kind === type).flatMap((each) => offeredModels(each)),
      ),
    ],
    efforts: effortsTakenBy(type),
  });
}

/**
 * A model or an effort `type` doesn't offer, in the spec's words (§5.4.5, "The API"), each passing
 * when it is what `kept` already has, so a model since withdrawn can stay.
 */
export function modelEffortProblems(
  type: EngineKind,
  { model, effort }: ModelAndEffortSetting,
  kept: ModelAndEffortSetting | null,
  offers: EngineTypeOffers,
): string[] {
  const offer = offers(type);
  const name = ENGINE_TYPE_NAMES[type];
  const problems: string[] = [];
  if (model !== null && model !== kept?.model && !offer.models.includes(model)) {
    problems.push(`Choose a model ${name} offers.`);
  }
  if (effort !== null && effort !== kept?.effort && !offer.efforts.includes(effort)) {
    problems.push(`Choose an effort ${name} takes.`);
  }
  return problems;
}

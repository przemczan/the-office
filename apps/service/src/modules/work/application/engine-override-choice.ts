import {
  engineTypeOffersOf,
  modelEffortProblems,
  type EngineId,
  type EngineKind,
  type EngineModels,
} from "../../engine/index.js";
import type { TaskPersonEngine } from "../domain/work-engine.js";

/**
 * Why a Task's or an Initiative's engine override can't be saved: an engine Settings › Engines
 * doesn't list. None for no override.
 */
export async function engineOverrideProblems(
  engines: EngineModels,
  engineId: EngineId | null,
): Promise<string[]> {
  if (engineId === null) return [];
  return (await engines.find(engineId)) === undefined ? [`There is no engine "${engineId}".`] : [];
}

/**
 * Why a Task's setting for people can't be saved, in the spec's words (§5.4.5, "The API"): a model
 * its engine type doesn't offer among the engines listed now, or an effort the type doesn't take,
 * as a Project's setting for a person is weighed. What `kept` already has passes, so a model since
 * withdrawn can stay.
 */
export async function taskPeopleProblems(
  engines: EngineModels,
  people: readonly TaskPersonEngine[],
  kept: readonly TaskPersonEngine[],
): Promise<string[]> {
  const offers = engineTypeOffersOf(await engines.engines());
  const problems = people.flatMap(({ roleKey, engineSettings }) => {
    const stored = kept.find((person) => person.roleKey === roleKey)?.engineSettings;
    return Object.entries(engineSettings).flatMap(([key, setting]) => {
      const type = key as EngineKind;
      return modelEffortProblems(type, setting, stored?.[type] ?? null, offers);
    });
  });
  return [...new Set(problems)];
}

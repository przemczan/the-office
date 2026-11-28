import {
  engineTypeOffersOf,
  ENGINE_TYPE_NAMES,
  modelEffortProblems,
  standInListProblems,
  type Engine,
  type EngineKind,
  type EngineTypeOffers,
} from "../../engine/index.domain.js";
import type {
  ModelEffort,
  ProjectEngine,
  ProjectEngineDefault,
  ProjectEnginePerson,
  ProjectStandIns,
} from "./project.js";

/** A save of the Project page's Engine block: a level sent replaces it, one left out stays. */
export interface ProjectEngineChange {
  readonly default?: ProjectEngineDefault | null;
  readonly force?: ModelEffort | null;
  readonly people?: readonly ProjectEnginePerson[];
  readonly standIns?: ProjectStandIns;
}

/**
 * Why the Project can't run on `after` with the engines listed now, in the spec's words (§5.4.5,
 * "The API"): a default on an engine not listed or of another type than it names, a forced model
 * or effort its type doesn't offer, a person's model or effort their type doesn't offer, and a
 * changed Stand-in Engine list naming an engine not listed or one twice (`standInListProblems`),
 * whether the Project uses it or not. What is already stored in `before` passes, so a setting for
 * a type no engine is listed of can stay.
 */
export function projectEngineProblems(
  after: ProjectEngine,
  before: ProjectEngine,
  engines: readonly Engine[],
): string[] {
  const offers = engineTypeOffersOf(engines);
  const problems: string[] = [];
  const { default: projectDefault, force } = after;
  if (projectDefault !== null && !sameDefault(projectDefault, before.default)) {
    const engine = engines.find(({ id }) => id === projectDefault.engineId);
    if (engine === undefined) {
      problems.push(`There is no engine "${projectDefault.engineId}".`);
    } else if (engine.kind !== projectDefault.engineType) {
      problems.push(
        `${engine.name} isn't a ${ENGINE_TYPE_NAMES[projectDefault.engineType]} account.`,
      );
    }
  }
  if (projectDefault !== null && force !== null) {
    const kept = before.default?.engineType === projectDefault.engineType ? before.force : null;
    problems.push(...modelEffortProblems(projectDefault.engineType, force, kept, offers));
  }
  for (const { roleKey, engineSettings } of after.people) {
    const stored = before.people.find((person) => person.roleKey === roleKey)?.engineSettings;
    for (const [key, setting] of Object.entries(engineSettings)) {
      const type = key as EngineKind;
      problems.push(...modelEffortProblems(type, setting, stored?.[type] ?? null, offers));
    }
  }
  if (!sameEngineIds(after.standIns.engineIds, before.standIns.engineIds)) {
    problems.push(...standInListProblems(after.standIns.engineIds, engines));
  }
  return [...new Set(problems)];
}

/** The force with what `type` doesn't offer back to "Engine's default". */
export function forceOfferedBy(
  force: ModelEffort,
  type: EngineKind,
  offers: EngineTypeOffers,
): ModelEffort {
  const offer = offers(type);
  return {
    model: force.model !== null && offer.models.includes(force.model) ? force.model : null,
    effort: force.effort !== null && offer.efforts.includes(force.effort) ? force.effort : null,
  };
}

/** Whether two sets of the Project's engine levels are the same, setting for setting. */
export function sameProjectEngine(first: ProjectEngine, second: ProjectEngine): boolean {
  return (
    sameDefault(first.default, second.default) &&
    sameModelEffort(first.force, second.force) &&
    first.people.length === second.people.length &&
    first.people.every((person, index) => samePerson(person, second.people[index]!)) &&
    sameStandIns(first.standIns, second.standIns)
  );
}

/** Whether two Stand-in Engine lists are the same, the toggle and the engines in order. */
export function sameStandIns(first: ProjectStandIns, second: ProjectStandIns): boolean {
  return first.useOwnList === second.useOwnList && sameEngineIds(first.engineIds, second.engineIds);
}

function sameEngineIds(first: readonly string[], second: readonly string[]): boolean {
  return first.length === second.length && first.every((id, index) => id === second[index]);
}

export function sameDefault(
  first: ProjectEngineDefault | null,
  second: ProjectEngineDefault | null,
): boolean {
  if (first === null || second === null) return first === second;
  return first.engineType === second.engineType && first.engineId === second.engineId;
}

function sameModelEffort(first: ModelEffort | null, second: ModelEffort | null): boolean {
  if (first === null || second === null) return first === second;
  return first.model === second.model && first.effort === second.effort;
}

function samePerson(first: ProjectEnginePerson, second: ProjectEnginePerson): boolean {
  const firstTypes = Object.keys(first.engineSettings) as EngineKind[];
  return (
    first.roleKey === second.roleKey &&
    firstTypes.length === Object.keys(second.engineSettings).length &&
    firstTypes.every((type) =>
      sameModelEffort(first.engineSettings[type] ?? null, second.engineSettings[type] ?? null),
    )
  );
}

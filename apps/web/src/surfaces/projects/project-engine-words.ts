import type {
  Engine,
  EngineKind,
  EngineTypeSetting,
  ModelEffort,
  PersonEngineSettings,
  ProjectEngine,
  ProjectEnginePerson,
} from "@the-office/contracts";
import type { EngineTypeChoice } from "../../shell/engine-type-account-fields.tsx";
import {
  EFFORT_LABELS,
  ENGINE_KIND_LABELS,
  ENGINE_KINDS,
  modelLabel,
} from "../../shell/engine-words.ts";
import { type TypeOffer } from "../../shell/engine-offers.ts";
import { ENGINES_DEFAULT, takesEffort } from "../../shell/role-card-words.ts";

/** The words and the sums of a Project's Engine card (screens/project-page.md "Engine"). */

export const WHERE_SESSIONS_RUN = "Where sessions run";
export const WHERE_SESSIONS_RUN_NOTE =
  "A Task's or its Initiative's engine override wins over this.";
export const FOR_EVERYONE = "Model and effort for everyone";
export const FOR_EVERYONE_NOTE =
  "Past each person's own settings and the ones below. A Stage's effort still wins.";
export const FORCE_LABEL = "Force this model and effort for everyone";
export const PICK_A_TYPE_FIRST = "Pick an engine type first.";
export const PER_PERSON = "Model and effort per person";
export const PER_PERSON_NOTE = "Wins over the person's Role card in this Project.";
export const PERSONS_SETTING = "Person's setting";
export const FORCED_ABOVE = "Forced above";
export const EVERYONE_HAS_A_ROW = "Everyone has a row already.";
export const NOBODY_HAS_A_SETTING =
  "Nobody has a setting of their own here, so each person works with their Role card's.";
export const TURN_OFF_THE_FORCE_TOO = "Turn off the force too?";
export const STAND_IN_ENGINES = "Stand-in Engines";
export const STAND_IN_ENGINES_NOTE =
  "Take over when an engine's usage window is used up. A Task or Initiative with its own engine uses none.";
export const USE_OWN_LIST = "Use this Project's own list";
export const FROM_SETTINGS_ENGINES = "From Settings › Engines";
export const OFFICE_HAS_NO_STAND_IN = "The Office has no Stand-in Engine.";
export const ANOTHER_ENGINE_TYPE_NOTE =
  "Another engine type: a running Stage waits for the reset rather than switch to it.";

/** The Project's own list while it is empty. */
export function noStandInWords(projectName: string): string {
  return `No Stand-in Engine in ${projectName}, so its work waits for its own engine's usage window to free up.`;
}

export function standInsToast(projectName: string, useOwnList: boolean): string {
  return useOwnList
    ? `${projectName} uses its own Stand-in Engines.`
    : `${projectName} uses the Office's Stand-in Engines again.`;
}

/** The force's note: which sessions it reaches. */
export function forceNote(type: EngineKind): string {
  return `Only for sessions on ${ENGINE_KIND_LABELS[type]}: one that lands on another type, through an override or a stand-in, works with the settings below.`;
}

/** The confirm's words, when the type goes back to the Office's default while the force is on. */
export function turnOffTheForceWords(projectName: string): string {
  return `The force works only on ${projectName}'s own engine type, so going back to the Office's default turns it off: everyone works with their own settings again.`;
}

/**
 * "Opus 5.5 · High": a model and an effort, a part left unset reading `unset`; a type that takes no
 * effort names its model only.
 */
export function modelEffortWords(
  type: EngineKind,
  setting: EngineTypeSetting | undefined,
  unset: string,
): string {
  const model = setting?.model ? modelLabel(setting.model) : unset;
  if (!takesEffort(type)) return model;
  const effort = setting?.effort ? EFFORT_LABELS[setting.effort] : unset;
  return `${model} · ${effort}`;
}

export function typeToast(projectName: string, engineName: string | null): string {
  return engineName === null
    ? `${projectName} runs on the Office default again.`
    : `${projectName} runs on ${engineName} by default.`;
}

export function forceToast(
  projectName: string,
  type: EngineKind,
  force: ModelEffort | null,
): string {
  return force === null
    ? `People in ${projectName} work with their own settings again.`
    : `Everyone in ${projectName} works with ${modelEffortWords(type, force, ENGINES_DEFAULT)} on ${ENGINE_KIND_LABELS[type]}.`;
}

export function addWindowTitle(projectName: string): string {
  return `Model and effort for a person in ${projectName}`;
}

export function editWindowTitle(person: string, projectName: string): string {
  return `${person}'s model and effort in ${projectName}`;
}

export function removeWindowTitle(person: string, projectName: string): string {
  return `Remove ${person}'s settings in ${projectName}?`;
}

export const REMOVE_WINDOW_TEXT = "They work with their Role card's model and effort here again.";

export function nothingIsSetHint(person: string): string {
  return `Nothing is set: Remove ${person} instead.`;
}

export function addedToast(person: string, projectName: string): string {
  return `${person} has their own model and effort in ${projectName}.`;
}

export function savedToast(person: string, projectName: string): string {
  return `${person}'s model and effort in ${projectName} are saved.`;
}

export function removedToast(person: string, projectName: string): string {
  return `${person}'s model and effort in ${projectName} are removed.`;
}

export function roleCardHint(type: EngineKind, setting: EngineTypeSetting | undefined): string {
  return `Role card: ${modelEffortWords(type, setting, ENGINES_DEFAULT)}`;
}

export function forcedAboveHint(type: EngineKind, force: ModelEffort): string {
  return `Forced above: ${modelEffortWords(type, force, ENGINES_DEFAULT)} wins while the force is on.`;
}

/** The engine types with an engine listed, in the spec's order, each with its accounts in the list's. */
export function typeChoicesOf(engines: readonly Engine[]): readonly EngineTypeChoice[] {
  return ENGINE_KINDS.flatMap((engineType) => {
    const accounts = engines
      .filter(({ kind }) => kind === engineType)
      .map(({ id, name }) => ({ id, name }));
    return accounts.length === 0 ? [] : [{ engineType, accounts }];
  });
}

/** The table's and the window's types: those with an engine listed, the Project's own first. */
export function personTypesOf(
  choices: readonly EngineTypeChoice[],
  projectType: EngineKind | null,
): readonly EngineKind[] {
  const types = choices.map(({ engineType }) => engineType);
  return projectType !== null && types.includes(projectType)
    ? [projectType, ...types.filter((type) => type !== projectType)]
    : types;
}

/**
 * The force as it goes onto another engine type: kept on, a model or an effort the new type doesn't
 * offer back to the engine's default.
 */
export function forceOnType(force: ModelEffort, offer: TypeOffer): ModelEffort {
  return {
    model: force.model !== null && offer.models.includes(force.model) ? force.model : null,
    effort: force.effort !== null && offer.efforts.includes(force.effort) ? force.effort : null,
  };
}

/** Whether a setting sets anything at all. */
export function setsAnything(setting: EngineTypeSetting | undefined): boolean {
  return setting !== undefined && (setting.model !== null || setting.effort !== null);
}

/**
 * The person's settings once the window's values for the types it shows are put over what is
 * stored, a type set to nothing left out; a type with no engine listed keeps what it has.
 */
export function mergedSettings(
  stored: PersonEngineSettings,
  shown: Partial<Record<EngineKind, EngineTypeSetting>>,
): PersonEngineSettings {
  const merged: Partial<Record<EngineKind, EngineTypeSetting>> = { ...stored };
  for (const type of ENGINE_KINDS) {
    if (!(type in shown)) continue;
    const setting = shown[type];
    if (setsAnything(setting)) merged[type] = setting;
    else delete merged[type];
  }
  return merged;
}

/**
 * The Project's people with one person's settings put in place, or added last; or taken out when
 * `engineSettings` is null. Built from the Project as it is now, so another person's change kept.
 */
export function peopleWith(
  engine: Pick<ProjectEngine, "people">,
  roleKey: string,
  engineSettings: PersonEngineSettings | null,
): ProjectEnginePerson[] {
  const others = engine.people.filter((person) => person.roleKey !== roleKey);
  if (engineSettings === null) return others;
  const at = engine.people.findIndex((person) => person.roleKey === roleKey);
  const entry = { roleKey, engineSettings };
  if (at < 0) return [...others, entry];
  return engine.people.map((person) => (person.roleKey === roleKey ? entry : person));
}

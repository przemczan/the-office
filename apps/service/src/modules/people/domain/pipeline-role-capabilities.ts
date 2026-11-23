import type { EngineCapability, EngineId } from "../../engine/index.js";
import { engineInCascade, type EngineCascadeLevels, type EngineInPlace } from "./engine-cascade.js";

/**
 * What a Role a Pipeline names needs of its engine: an Agent Stage gives its session Office tools
 * and holds its answer to the Stage result's schema. Other Roles take any engine (the user,
 * 2026-11-02; spec §5.4).
 */
export const PIPELINE_ROLE_CAPABILITIES = [
  "officeTools",
  "outputSchema",
] as const satisfies readonly EngineCapability[];
export type PipelineRoleCapability = (typeof PIPELINE_ROLE_CAPABILITIES)[number];

/**
 * A Role a Pipeline names that the cascade puts on an engine lacking what its Stages need, or that
 * a Stand-in Engine of the list that applies there would take over on.
 */
export interface RoleOnIncapableEngine {
  readonly roleKey: string;
  readonly engineId: string;
  readonly missing: readonly PipelineRoleCapability[];
  /** In an Initiative's refusal, the Task the Role was found on. */
  readonly taskTitle?: string;
  /** Reached as a Stand-in Engine of the list that applies, not as the cascade's engine. */
  readonly standIn?: true;
}

/**
 * The Stand-in Engines in reach in a place (spec §5.4.5): the list the cascade says applies there,
 * the Project's own or the Office's, less the cascade's own engine, which never stands in for
 * itself. Which list applies is the cascade's `standInsApplying` alone, so a place with an engine
 * override, which uses no Stand-in Engine (spec §5.4.6), weighs none.
 */
export function standInsInReach(inPlace: EngineInPlace): readonly EngineId[] {
  return [...new Set(inPlace.standIns.engineIds)].filter(
    (engineId) => engineId !== inPlace.engineId,
  );
}

/**
 * The Roles of `roleKeys` whose engine in the cascade, the one everyone in the place runs on, at
 * `levels` (in a Project or in none, on a Task or an Initiative with an engine override), lacks a
 * capability their Agent Stages need, then the Roles again on each Stand-in Engine in reach there
 * that lacks one (`standInsInReach`: none under an override); a Role on no engine, with none
 * listed, lacks nothing here. `missingCapabilities` gives what an engine can't do.
 */
export function rolesOnIncapableEngines(
  roleKeys: Iterable<string>,
  levels: EngineCascadeLevels,
  missingCapabilities: (engineId: string) => readonly EngineCapability[],
): RoleOnIncapableEngine[] {
  const applying = engineInCascade(levels);
  if (applying === null) return [];
  const roles = [...roleKeys];
  const missingOf = (engineId: string) =>
    PIPELINE_ROLE_CAPABILITIES.filter((capability) =>
      missingCapabilities(engineId).includes(capability),
    );
  const onEngine = (engineId: string, standIn: boolean): RoleOnIncapableEngine[] => {
    const missing = missingOf(engineId);
    if (missing.length === 0) return [];
    return roles.map((roleKey) => ({
      roleKey,
      engineId,
      missing,
      ...(standIn && { standIn: true as const }),
    }));
  };
  return [
    ...onEngine(applying.engineId, false),
    ...standInsInReach(applying).flatMap((engineId) => onEngine(engineId, true)),
  ];
}

/**
 * Those of `after` that `before` didn't hold: what a save would newly cause. On the cascade's
 * engine a Role counts once, whichever engine; as a stand-in, once on each engine.
 */
export function newlyOnIncapableEngines(
  before: readonly RoleOnIncapableEngine[],
  after: readonly RoleOnIncapableEngine[],
): RoleOnIncapableEngine[] {
  const already = new Set(before.map(keyOf));
  return after.filter((each) => !already.has(keyOf(each)));
}

function keyOf({ roleKey, engineId, standIn }: RoleOnIncapableEngine): string {
  return JSON.stringify(standIn ? [roleKey, engineId] : [roleKey]);
}

/** How the refusal names Roles, engines and the place they would run in. */
export interface IncapableEngineNames {
  readonly roleTitle: (roleKey: string) => string;
  readonly engineName: (engineId: string) => string;
  /** The Project's name, or undefined outside any Project. */
  readonly projectName: string | undefined;
  /** The place in words, "On “<Task>”" or "In <Initiative>", in place of the Project's. */
  readonly place?: string;
}

const MISSING_CAPABILITY_WORDS: Readonly<Record<PipelineRoleCapability, string>> = {
  officeTools: "use Office tools",
  outputSchema: "hold its answer to the Stage result's schema",
};

const AND = new Intl.ListFormat("en", { type: "conjunction" });
const OR = new Intl.ListFormat("en", { type: "disjunction" });

/**
 * One refusal for each engine, naming what it lacks and the Roles that would run on it, once each
 * (spec §5.4.5): "<engine> can't use Office tools, which the Agent Stages of the Developer need in
 * <Project>." ("outside any Project"); in a `place`, "On “<Task>”, <engine> can't …, which … need.",
 * and in an Initiative's, the Tasks they were found on: "… need on “<Task>”.". An engine reached as
 * a Stand-in Engine is refused apart: "<engine> can't stand in: it can't use Office tools, …".
 */
export function incapableEngineProblems(
  found: readonly RoleOnIncapableEngine[],
  { roleTitle, engineName, projectName, place }: IncapableEngineNames,
): string[] {
  const engines = [
    ...new Map(
      found.map(({ engineId, standIn }) => [
        JSON.stringify([engineId, standIn === true]),
        { engineId, standIn: standIn === true },
      ]),
    ).values(),
  ];
  return engines.map(({ engineId, standIn }) => {
    const onEngine = found.filter(
      (each) => each.engineId === engineId && (each.standIn === true) === standIn,
    );
    const roles = AND.format(
      [...new Set(onEngine.map(({ roleKey }) => roleKey))].map(
        (roleKey) => `the ${roleTitle(roleKey)}`,
      ),
    );
    const missing = OR.format(
      PIPELINE_ROLE_CAPABILITIES.filter((capability) =>
        onEngine.some((each) => each.missing.includes(capability)),
      ).map((capability) => MISSING_CAPABILITY_WORDS[capability]),
    );
    const cant = standIn ? `can't stand in: it can't ${missing}` : `can't ${missing}`;
    const refusal = `${engineName(engineId)} ${cant}, which the Agent Stages of ${roles} need`;
    if (place === undefined) {
      return `${refusal} ${projectName === undefined ? "outside any Project" : `in ${projectName}`}.`;
    }
    const taskTitles = [
      ...new Set(onEngine.flatMap(({ taskTitle }) => (taskTitle === undefined ? [] : [taskTitle]))),
    ];
    const onTasks =
      taskTitles.length === 0 ? "" : ` on ${AND.format(taskTitles.map((title) => `“${title}”`))}`;
    return `${place}, ${refusal}${onTasks}.`;
  });
}

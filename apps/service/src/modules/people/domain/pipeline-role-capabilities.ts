import type { EngineCapability, EngineModel } from "../../engine/index.js";
import {
  engineInCascade,
  NO_WORK_LEVELS,
  type ProjectCascadeLevels,
  type WorkCascadeLevels,
} from "./engine-cascade.js";

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

/** A Role a Pipeline names that the cascade puts on an engine lacking what its Stages need. */
export interface RoleOnIncapableEngine {
  readonly roleKey: string;
  readonly engineId: string;
  readonly missing: readonly PipelineRoleCapability[];
  /** In an Initiative's refusal, the Task the Role was found on. */
  readonly taskTitle?: string;
}

/**
 * The Roles of `roleKeys` whose engine in the cascade, the one everyone in the place runs on, in `project` or in no Project, and on a Task or
 * an Initiative setting `work`, lacks a capability their Agent Stages need; a Role on no engine,
 * with none listed, lacks nothing here. `missingCapabilities` gives what an engine can't do.
 */
export function rolesOnIncapableEngines(
  roleKeys: Iterable<string>,
  officeDefault: EngineModel | null,
  project: ProjectCascadeLevels | undefined,
  missingCapabilities: (engineId: string) => readonly EngineCapability[],
  work: WorkCascadeLevels = NO_WORK_LEVELS,
): RoleOnIncapableEngine[] {
  const applying = engineInCascade({ officeDefault, project, work });
  if (applying === null) return [];
  const { engineId } = applying;
  const missing = PIPELINE_ROLE_CAPABILITIES.filter((capability) =>
    missingCapabilities(engineId).includes(capability),
  );
  if (missing.length === 0) return [];
  return [...roleKeys].map((roleKey) => ({ roleKey, engineId, missing }));
}

/** Those of `after` that `before` didn't hold: what a save would newly cause. */
export function newlyOnIncapableEngines(
  before: readonly RoleOnIncapableEngine[],
  after: readonly RoleOnIncapableEngine[],
): RoleOnIncapableEngine[] {
  const already = new Set(before.map(({ roleKey }) => roleKey));
  return after.filter(({ roleKey }) => !already.has(roleKey));
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
 * and in an Initiative's, the Tasks they were found on: "… need on “<Task>”.".
 */
export function incapableEngineProblems(
  found: readonly RoleOnIncapableEngine[],
  { roleTitle, engineName, projectName, place }: IncapableEngineNames,
): string[] {
  const engineIds = [...new Set(found.map(({ engineId }) => engineId))];
  return engineIds.map((engineId) => {
    const onEngine = found.filter((each) => each.engineId === engineId);
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
    const refusal = `${engineName(engineId)} can't ${missing}, which the Agent Stages of ${roles} need`;
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

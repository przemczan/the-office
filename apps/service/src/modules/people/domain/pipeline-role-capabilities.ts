import type { EngineCapability, EngineModel } from "../../engine/index.js";
import { engineInCascade, type ProjectCascadeLevels } from "./engine-cascade.js";

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

/** A Role a Pipeline names, with its Office-wide Role override; none when nobody fills it. */
export interface PipelineRole {
  readonly roleKey: string;
  readonly roleOverride: EngineModel | null;
}

/** A Role a Pipeline names that the cascade puts on an engine lacking what its Stages need. */
export interface RoleOnIncapableEngine {
  readonly roleKey: string;
  readonly engineId: string;
  readonly missing: readonly PipelineRoleCapability[];
}

/**
 * The Roles of `roles` whose engine in the cascade, in `project` or in no Project, lacks a
 * capability their Agent Stages need; a Role on no engine, with none listed, lacks nothing here.
 * `missingCapabilities` gives what an engine can't do.
 */
export function rolesOnIncapableEngines(
  roles: readonly PipelineRole[],
  officeDefault: EngineModel | null,
  project: ProjectCascadeLevels | undefined,
  missingCapabilities: (engineId: string) => readonly EngineCapability[],
): RoleOnIncapableEngine[] {
  return roles.flatMap(({ roleKey, roleOverride }) => {
    const applying = engineInCascade(roleKey, { officeDefault, roleOverride, project });
    if (applying === null) return [];
    const { engineId } = applying;
    const missing = PIPELINE_ROLE_CAPABILITIES.filter((capability) =>
      missingCapabilities(engineId).includes(capability),
    );
    return missing.length === 0 ? [] : [{ roleKey, engineId, missing }];
  });
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
}

const MISSING_CAPABILITY_WORDS: Readonly<Record<PipelineRoleCapability, string>> = {
  officeTools: "use Office tools",
  outputSchema: "hold a Stage's answer to a schema",
};

const AND = new Intl.ListFormat("en", { type: "conjunction" });
const OR = new Intl.ListFormat("en", { type: "disjunction" });

/** One refusal for each engine, naming the Roles that would run on it and what it lacks. */
export function incapableEngineProblems(
  found: readonly RoleOnIncapableEngine[],
  { roleTitle, engineName, projectName }: IncapableEngineNames,
): string[] {
  const place = projectName === undefined ? "Outside any Project" : `In ${projectName}`;
  const engineIds = [...new Set(found.map(({ engineId }) => engineId))];
  return engineIds.map((engineId) => {
    const onEngine = found.filter((each) => each.engineId === engineId);
    const roles = AND.format(onEngine.map(({ roleKey }) => `the ${roleTitle(roleKey)}`));
    const missing = OR.format(
      PIPELINE_ROLE_CAPABILITIES.filter((capability) =>
        onEngine.some((each) => each.missing.includes(capability)),
      ).map((capability) => MISSING_CAPABILITY_WORDS[capability]),
    );
    return `${place}, ${roles} would run on ${engineName(engineId)}, which can't ${missing}, as their Pipelines' Agent Stages need.`;
  });
}

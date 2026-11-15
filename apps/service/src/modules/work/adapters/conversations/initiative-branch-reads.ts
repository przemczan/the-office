import type { InitiativeBranchReads } from "../../../conversations/index.js";
import { initiativeProjectIds, pipelineIn, type Initiative } from "../../domain/initiative.js";
import { initiativeBranchOf } from "../../domain/short-name.js";
import type { Task } from "../../domain/task.js";

/**
 * The Projects an active Initiative is read at its branch in (spec §2.4): those it spans now that
 * have a Pipeline and its branch; one it stopped spanning, or with None, is read at its base.
 * Undefined while it is shaping, or on None in every Project, so it reads base branches.
 */
export function initiativeBranchReads(
  initiative: Initiative,
  tasks: readonly Task[],
): InitiativeBranchReads | undefined {
  const { state, shortName, branches } = initiative;
  if (state !== "active" || shortName === undefined) return undefined;
  const branched = new Set(branches.map(({ projectId }) => projectId));
  return {
    shortName,
    branch: initiativeBranchOf(shortName),
    projectIds: initiativeProjectIds(tasks).filter(
      (projectId) => branched.has(projectId) && pipelineIn(initiative, projectId) !== undefined,
    ),
  };
}

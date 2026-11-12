import type { Initiative } from "./initiative.js";
import { initiativeBranchOf } from "./short-name.js";
import { TaskRefused } from "./task-refused.js";

/**
 * What a Task's branch starts from and publishes into (spec 5.5, "A worktree per Task"): the
 * Project's base branch, or the Initiative's branch in the Project for a Task of an Initiative
 * with a Pipeline.
 */
export type TaskBranchBase =
  | { readonly kind: "base-branch" }
  | { readonly kind: "initiative-branch"; readonly branch: string };

const BASE_BRANCH: TaskBranchBase = { kind: "base-branch" };

/**
 * The base of a Task in the Project `projectId`, by its Initiative: the base branch with none or
 * one on None, else the Initiative's branch there. Refused when the Initiative has a Pipeline but
 * no branch in the Project, never the base branch in its place, as the Task would publish there.
 */
export function taskBranchBase(
  initiative: Pick<Initiative, "name" | "pipelineId" | "shortName" | "branches"> | undefined,
  projectId: string,
  projectName: string,
): TaskBranchBase {
  if (initiative?.pipelineId === undefined) return BASE_BRANCH;
  const { shortName } = initiative;
  if (
    shortName === undefined ||
    !initiative.branches.some((branch) => branch.projectId === projectId)
  ) {
    throw new TaskRefused([
      `The Initiative "${initiative.name}" has no branch in ${projectName}, so its Task there has nothing to start from or publish into.`,
    ]);
  }
  return { kind: "initiative-branch", branch: initiativeBranchOf(shortName) };
}

/** Start's refusal of a Task whose Initiative's branch the user deleted (spec 5.5, "Kept"). */
export function initiativeBranchGoneRefusal(branch: string, projectName: string): string {
  return `The Initiative's branch ${branch} is gone from ${projectName}, so the Task can't start.`;
}

import { pipelineIn, type Initiative } from "./initiative.js";
import { initiativeBranchOf } from "./short-name.js";
import { isPublishingTask, type Task } from "./task.js";
import { TaskRefused } from "./task-refused.js";

/**
 * What a Task's branch starts from and publishes into (spec 5.5, "A worktree per Task"): the
 * Project's base branch, or the Initiative's branch in the Project for a Task of an Initiative
 * with a Pipeline in that Project. A Publishing Task works on the Initiative's branch itself and publishes it into
 * the base branch.
 */
export type TaskBranchBase =
  | { readonly kind: "base-branch" }
  | { readonly kind: "initiative-branch"; readonly branch: string }
  | { readonly kind: "publishing-task"; readonly branch: string };

const BASE_BRANCH: TaskBranchBase = { kind: "base-branch" };

/**
 * The base of a Task in the Project `projectId`, by its Initiative: the base branch with none or
 * one on None in that Project, else the Initiative's branch there, which a Publishing Task holds itself. Refused
 * when the Initiative has a Pipeline but no branch in the Project, never the base branch in its
 * place, as the Task would publish there.
 */
export function taskBranchBase(
  task: Pick<Task, "madeFor">,
  initiative: Pick<Initiative, "name" | "pipelines" | "shortName" | "branches"> | undefined,
  projectId: string,
  projectName: string,
): TaskBranchBase {
  if (!initiative || pipelineIn(initiative, projectId) === undefined) return BASE_BRANCH;
  const { shortName } = initiative;
  if (
    shortName === undefined ||
    !initiative.branches.some((branch) => branch.projectId === projectId)
  ) {
    throw new TaskRefused([
      `The Initiative "${initiative.name}" has no branch in ${projectName}, so its Task there has nothing to start from or publish into.`,
    ]);
  }
  const branch = initiativeBranchOf(shortName);
  return isPublishingTask(task)
    ? { kind: "publishing-task", branch }
    : { kind: "initiative-branch", branch };
}

/** Start's refusal of a Task whose Initiative's branch the user deleted (spec 5.5, "Kept"). */
export function initiativeBranchGoneRefusal(branch: string, projectName: string): string {
  return `The Initiative's branch ${branch} is gone from ${projectName}, so the Task can't start.`;
}

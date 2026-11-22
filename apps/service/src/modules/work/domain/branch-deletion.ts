import { authorWords, type Author } from "./author.js";
import { pipelineIn, type Initiative } from "./initiative.js";
import type { InitiativeChange } from "./initiative-changes.js";
import { InitiativeBranchDeleted } from "./initiative-events.js";
import { initiativeBranchOf } from "./short-name.js";
import { isPublishingTask, type Task } from "./task.js";
import type { TaskChange } from "./task-changes.js";
import { TaskBranchDeleted } from "./task-events.js";

/** Who deleted a branch: a user, by hand, or The Office, by Delete branches once merged. */
export type BranchDeletedBy = Author | { readonly kind: "office" };

/** Delete branches once merged, deleting a branch merged into its base (spec 5.5). */
export const BY_DELETE_MERGED_BRANCHES: BranchDeletedBy = { kind: "office" };

/** A copy of the branch that went: the local one, or the remote's, named `<remote>/<branch>`. */
export interface DeletedBranchCopy {
  readonly kind: "local" | "remote";
  readonly name: string;
}

/** A branch's deletion as a Task's or an Initiative's record keeps it (spec 5.5). */
export interface BranchDeletionRecord {
  readonly branch: string;
  /** The copies that went; one gone already, as on the code host, isn't among them. */
  readonly copies: readonly DeletedBranchCopy[];
  readonly by: BranchDeletedBy;
  readonly at: Date;
}

/**
 * Keeps the Task's branch's deletion on its record, in any state, archived too; never moves it.
 * Undefined when it deleted no copy and an earlier deletion is kept, as one judged meanwhile finds
 * the branch gone and mustn't replace the line naming what went.
 */
export function recordTaskBranchDeletion(
  task: Task,
  deletion: BranchDeletionRecord,
): TaskChange<TaskBranchDeleted> | undefined {
  if (keepsEarlier(task.branchDeletion, deletion)) return undefined;
  return {
    task: { ...task, branchDeletion: deletion },
    event: new TaskBranchDeleted(task.id, deletion.at),
  };
}

/**
 * Keeps the deletion of the Initiative's branch in `projectId` on that branch's entry; undefined
 * when the Initiative has no branch there, or, as for a Task, when it deleted no copy and an
 * earlier deletion is kept.
 */
export function recordInitiativeBranchDeletion(
  initiative: Initiative,
  projectId: string,
  deletion: BranchDeletionRecord,
): InitiativeChange<InitiativeBranchDeleted> | undefined {
  const made = initiative.branches.find((branch) => branch.projectId === projectId);
  if (!made || keepsEarlier(made.deletion, deletion)) return undefined;
  return {
    initiative: {
      ...initiative,
      branches: initiative.branches.map((branch) =>
        branch.projectId === projectId ? { ...branch, deletion } : branch,
      ),
    },
    event: new InitiativeBranchDeleted(initiative.id, projectId, deletion.at),
  };
}

function keepsEarlier(
  earlier: BranchDeletionRecord | undefined,
  deletion: BranchDeletionRecord,
): boolean {
  return earlier !== undefined && deletion.copies.length === 0;
}

/**
 * The record's line: "Branch office/… deleted here and on origin by The Office (merged) on …", or
 * "… by the user Ann Lee on …".
 */
export function branchDeletionWords({ branch, copies, by, at }: BranchDeletionRecord): string {
  const where = copyWords(branch, copies);
  const who = by.kind === "office" ? "The Office (merged)" : authorWords(by);
  return `Branch ${branch} deleted${where === "" ? "" : ` ${where}`} by ${who} on ${at.toISOString()}`;
}

/** "here and on origin": the local copy as here, each remote's by its remote's name. */
function copyWords(branch: string, copies: readonly DeletedBranchCopy[]): string {
  return copies
    .map(({ kind, name }) =>
      kind === "local"
        ? "here"
        : `on ${name.endsWith(`/${branch}`) ? name.slice(0, -branch.length - 1) : name}`,
    )
    .join(" and ");
}

/** The Task's own branch, `office/<task id>`; undefined for a Publishing Task or a Conflict resolution Task, which hold none. */
export function taskBranchOf(task: Pick<Task, "id" | "madeFor">): string | undefined {
  if (isPublishingTask(task) || task.madeFor === "resolve-conflicts") return undefined;
  return `office/${task.id}`;
}

/** The Task a branch named `office/<task id>` is of; undefined for any other name. */
export function taskIdOfBranch(branch: string): string | undefined {
  return TASK_BRANCH.exec(branch)?.[1];
}

/** The Short name a branch named `initiative/<short name>` is of; undefined for any other name. */
export function shortNameOfBranch(branch: string): string | undefined {
  return branch.startsWith(INITIATIVE_BRANCH_PREFIX)
    ? branch.slice(INITIATIVE_BRANCH_PREFIX.length) || undefined
    : undefined;
}

const TASK_BRANCH = /^office\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const INITIATIVE_BRANCH_PREFIX = initiativeBranchOf("");

/**
 * The Initiative's branch the Task publishes into, when it is an Initiative's with a Pipeline in
 * its Project and a branch there; undefined for one publishing to the base branch.
 */
export function initiativeBranchOfTask(
  task: Pick<Task, "projectId">,
  initiative: Pick<Initiative, "pipelines" | "shortName" | "branches"> | undefined,
): string | undefined {
  if (!initiative || initiative.shortName === undefined) return undefined;
  if (pipelineIn(initiative, task.projectId) === undefined) return undefined;
  if (!initiative.branches.some(({ projectId }) => projectId === task.projectId)) return undefined;
  return initiativeBranchOf(initiative.shortName);
}

/** Why the Task's branch can't be deleted yet: it hasn't ended; undefined once Done or Dropped. */
export function taskBranchDeletionRefusal(task: Pick<Task, "state">): string | undefined {
  return hasEnded(task) ? undefined : "The Task isn't Done or Dropped, so its branch stays.";
}

/**
 * Why the Initiative's branch in the Project can't be deleted yet: the Initiative hasn't ended, or
 * one of its Tasks there, its Publishing Tasks included, hasn't; undefined otherwise.
 */
export function initiativeBranchDeletionRefusal(
  initiative: Pick<Initiative, "state">,
  tasks: readonly Pick<Task, "projectId" | "state" | "title">[],
  projectId: string,
): string | undefined {
  if (initiative.state !== "done" && initiative.state !== "dropped") {
    return "The Initiative isn't Done or Dropped, so its branch stays.";
  }
  const going = tasks.find((task) => task.projectId === projectId && !hasEnded(task));
  return going ? `The Task "${going.title}" hasn't ended, so the branch stays.` : undefined;
}

function hasEnded(task: Pick<Task, "state">): boolean {
  return task.state === "done" || task.state === "dropped";
}

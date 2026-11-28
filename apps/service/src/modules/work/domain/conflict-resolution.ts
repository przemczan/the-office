import { RUN_PROJECT_COMMAND_TOOL } from "../../engine/index.domain.js";
import type { Task } from "./task.js";
import { TITLE_LENGTH } from "./title.js";
import type { TaskChange } from "./task-changes.js";
import type { TaskCreated } from "./task-events.js";
import { createTaskMadeFor, type MadeTaskSetting } from "./task-made-for.js";

/** The built-in "Resolve conflicts" Pipeline, keyed as Pipelines' library keys it. */
export const RESOLVE_CONFLICTS_PIPELINE = "resolve-conflicts";

/** The Office tool that merges the base branch into the Task's branch, kept by Pipelines. */
const UPDATE_BRANCH_TOOL = "update_branch";

/** The pull request with conflicts a Conflict resolution Task resolves, as Work reads it. */
export interface ConflictingPullRequest {
  /** The Project it was opened from, where the Conflict resolution Task works. */
  readonly projectId: string;
  readonly number: number;
  readonly url: string;
  /** The branch the pull request merges, which the Conflict resolution Task holds. */
  readonly branch: string;
  /** The branch it merges into. */
  readonly baseBranch: string;
}

const TITLE_PREFIX = "Resolve conflicts: ";

/** `Resolve conflicts: <original title>`, the original's title cut short to keep within a title's length. */
export function conflictResolutionTitle(original: Pick<Task, "title">): string {
  const room = TITLE_LENGTH - TITLE_PREFIX.length;
  const title =
    original.title.length <= room ? original.title : `${original.title.slice(0, room - 1)}…`;
  return `${TITLE_PREFIX}${title}`;
}

/** What the user asked for, as The Office words it: the original Task and its pull request. */
export function conflictResolutionDescription(
  original: Pick<Task, "id" | "title">,
  pullRequest: ConflictingPullRequest,
): string {
  return `The pull request #${pullRequest.number} (${pullRequest.url}) of "${original.title}" (Task ${original.id}) has conflicts with ${pullRequest.baseBranch}. Resolve them on its branch ${pullRequest.branch}, so it can be merged.`;
}

/** What the Conflict resolution Task asks of its Agent, written by The Office. */
export function conflictResolutionPlan(pullRequest: ConflictingPullRequest): string {
  return [
    `Merge ${pullRequest.baseBranch} into ${pullRequest.branch} with ${UPDATE_BRANCH_TOOL}: a merge, never a rebase, so the pull request's history stays as it was pushed.`,
    "Resolve every conflict it leaves, keeping what both sides meant: the change of the pull request and what reached the base branch since. Read the original Task with read_task when its Plan helps. Remove every conflict marker.",
    `Run the Project's Test with ${RUN_PROJECT_COMMAND_TOOL} test and fix what it finds.`,
    `Publish then pushes the branch, without force, to the same pull request ${pullRequest.url}.`,
    "When the conflicts can't be resolved, or the Test can't pass, end the Stage failed and write why in the Handover note.",
  ].join("\n\n");
}

export function conflictResolutionDefinitionOfDone(
  pullRequest: ConflictingPullRequest,
): readonly string[] {
  return [
    `The branch ${pullRequest.branch} holds ${pullRequest.baseBranch}, merged into it.`,
    "No conflict markers are left in any file.",
    "The Project's Test passes.",
    `The branch is pushed to the same pull request ${pullRequest.url}.`,
  ];
}

/**
 * A Conflict resolution Task for `original`'s pull request: Ready on the "Resolve conflicts"
 * Pipeline, its Plan and Definition of Done written by The Office and confirmed, in the pull
 * request's Project. Never part of an Initiative, even when the original is its Publishing Task.
 */
export function createConflictResolutionTask(
  id: string,
  original: Pick<Task, "id" | "title">,
  pullRequest: ConflictingPullRequest,
  setting: Omit<MadeTaskSetting, "initiativeId">,
  createdAt: Date,
): TaskChange<TaskCreated> {
  return createTaskMadeFor(
    id,
    pullRequest.projectId,
    {
      madeFor: "resolve-conflicts",
      title: conflictResolutionTitle(original),
      description: conflictResolutionDescription(original, pullRequest),
      pipelineId: RESOLVE_CONFLICTS_PIPELINE,
      plan: conflictResolutionPlan(pullRequest),
      definitionOfDone: conflictResolutionDefinitionOfDone(pullRequest),
      resolvesTaskId: original.id,
    },
    { order: setting.order, createdBy: setting.createdBy },
    createdAt,
  );
}

/** Whether the Task is a Conflict resolution Task and neither Done nor Dropped. */
export function isOpenConflictResolution(task: Task): boolean {
  return task.madeFor === "resolve-conflicts" && task.state !== "done" && task.state !== "dropped";
}

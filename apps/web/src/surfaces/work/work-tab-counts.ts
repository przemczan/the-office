import type { Idea, Initiative, PullRequest, TaskSummary } from "@the-office/contracts";
import { projectIdsOfIdea } from "../../shell/work/work-words.ts";
import { isOnBoard } from "./board-filters.ts";
import { onTheBoard } from "./initiative-columns.ts";

/** The Project filter's rule: whether it shows a record of these Projects. */
export type ShownByProjectFilter = (projectIds: readonly string[]) => boolean;

/**
 * The Tasks tab's count: the Tasks on the board neither Done nor Dropped, in the Projects the Project
 * filter shows. The board's own filters leave it as it is.
 */
export function openTasksCount(tasks: readonly TaskSummary[], shows: ShownByProjectFilter): number {
  return tasks.filter(
    (task) =>
      isOnBoard(task) &&
      task.state !== "done" &&
      task.state !== "dropped" &&
      shows([task.projectId]),
  ).length;
}

/** The Initiatives tab's count: those in Shaping, not archived, in the Projects the filter shows. */
export function shapingInitiativesCount(
  initiatives: readonly Initiative[],
  shows: ShownByProjectFilter,
): number {
  return onTheBoard(initiatives).filter(
    (initiative) => initiative.state === "shaping" && shows(initiative.projectIds),
  ).length;
}

/** The Pull requests tab's count: the open pull requests in the Projects the Project filter shows. */
export function openPullRequestsCount(
  pullRequests: readonly PullRequest[],
  shows: ShownByProjectFilter,
): number {
  return pullRequests.filter((pullRequest) => shows([pullRequest.projectId])).length;
}

/** The Ideas tab's count: the new Ideas in the Projects the Project filter shows. */
export function newIdeasCount(ideas: readonly Idea[], shows: ShownByProjectFilter): number {
  return ideas.filter((idea) => idea.state === "new" && shows(projectIdsOfIdea(idea))).length;
}

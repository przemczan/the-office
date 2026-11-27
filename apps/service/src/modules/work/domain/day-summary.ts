import type { DropReason } from "./drop-reason.js";
import type { Task, TaskKind } from "./task.js";
import type { PullRequestEndedBy } from "./task-pull-request.js";
import { isInProjectFilter, type ProjectFilter } from "./project-filter.js";

/** An Initiative that became Done in the day, with the Projects its Tasks are in. */
export interface DayInitiative {
  readonly id: string;
  readonly name: string;
  readonly projectIds: readonly string[];
  readonly taskCount: number;
  readonly at: Date;
}

export interface DayTaskDone {
  readonly id: string;
  readonly title: string;
  readonly projectId: string;
  readonly kind: TaskKind;
  readonly pullRequestNumber: number | undefined;
  readonly at: Date;
}

export interface DayPullRequestMerged {
  readonly taskId: string;
  readonly title: string;
  readonly projectId: string;
  readonly number: number;
  readonly url: string;
  readonly by: PullRequestEndedBy;
  readonly at: Date;
}

/** A Task that failed for good, with the Stage that did, or was Dropped, with why. */
export interface DayFailedOrDropped {
  readonly outcome: "failed" | "dropped";
  readonly taskId: string;
  readonly title: string;
  readonly projectId: string;
  readonly stageName: string | undefined;
  readonly dropReason: DropReason | undefined;
  readonly at: Date;
}

export interface DayIdea {
  readonly id: string;
  readonly title: string;
  readonly projectId: string | undefined;
  readonly at: Date;
}

export interface DayTaskStarted {
  readonly id: string;
  readonly title: string;
  readonly projectId: string;
  readonly at: Date;
}

/** Everything that happened in a day, each group in no particular order. */
export interface DayFacts {
  readonly initiativesDone: readonly DayInitiative[];
  readonly tasksDone: readonly DayTaskDone[];
  readonly pullRequestsMerged: readonly DayPullRequestMerged[];
  readonly failedOrDropped: readonly DayFailedOrDropped[];
  readonly ideasCaptured: readonly DayIdea[];
  readonly tasksStarted: readonly DayTaskStarted[];
}

/** The day's groups the Project filter shows, newest first, and how many records it hides. */
export interface DayGroups extends DayFacts {
  readonly elsewhere: number;
}

/** What a Task done says of itself in the day. */
export function taskDoneOf(task: Task, at: Date): DayTaskDone {
  return {
    id: task.id,
    title: task.title,
    projectId: task.projectId,
    kind: task.kind,
    pullRequestNumber: task.pullRequestEnd?.number,
    at,
  };
}

function ownProject({ projectId }: { readonly projectId: string }): string[] {
  return [projectId];
}

/** Groups what happened in the day by the Project filter, newest first, counting what it hides. */
export function groupDay(facts: DayFacts, filter: ProjectFilter): DayGroups {
  let elsewhere = 0;
  const shown = <Record extends { readonly at: Date }>(
    records: readonly Record[],
    projectsOf: (record: Record) => readonly string[],
  ): Record[] => {
    const kept = records.filter((record) => isInProjectFilter(projectsOf(record), filter));
    elsewhere += records.length - kept.length;
    return kept.toSorted((one, other) => other.at.getTime() - one.at.getTime());
  };
  return {
    initiativesDone: shown(facts.initiativesDone, ({ projectIds }) => projectIds),
    tasksDone: shown(facts.tasksDone, ownProject),
    pullRequestsMerged: shown(facts.pullRequestsMerged, ownProject),
    failedOrDropped: shown(facts.failedOrDropped, ownProject),
    ideasCaptured: shown(facts.ideasCaptured, ({ projectId }) =>
      projectId === undefined ? [] : [projectId],
    ),
    tasksStarted: shown(facts.tasksStarted, ownProject),
    elsewhere,
  };
}

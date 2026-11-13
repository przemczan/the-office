import { normalizedFilesToChange } from "./files-to-change.js";
import { pipelineIn, type Initiative } from "./initiative.js";
import { initiativeBranchOf } from "./short-name.js";
import type { StateChangeCause } from "./state-change.js";
import { isPublishingTask, type Task } from "./task.js";
import type { TaskChange } from "./task-changes.js";
import { TaskPipelineConfirmed, type TaskCreated } from "./task-events.js";
import { createTaskMadeFor } from "./task-made-for.js";
import { NOT_STARTED_STATES } from "./task-states.js";
import { TITLE_LENGTH } from "./title.js";

/*
 * Publishing Tasks (spec 2.1, "Publishing Tasks"): once every other Task of an active Initiative
 * is Done or Dropped, The Office adds one per Project with a Pipeline whose Initiative's branch
 * holds unpublished work. It follows the Initiative's Pipeline in that Project on that branch, and its
 * Publish puts the whole change into the base branch by the Project's publishing mode.
 */

/** A Project a Publishing Task publishes in, as its Plan names it. */
export interface PublishingProject {
  readonly id: string;
  readonly name: string;
  readonly baseBranch: string;
  readonly publishingMode: "push-and-pull-request" | "merge";
}

/** What a Publishing Task is written from, besides its Project. */
export interface PublishingGrounds {
  readonly initiative: Initiative;
  readonly pipelineName: string;
  /** The Initiative's Done Tasks in the Project, in the order they were added. */
  readonly doneTasks: readonly Task[];
}

/** Why Make a plan, Plan with… and the Planner's rewrites refuse a Publishing Task. */
export const PUBLISHING_TASK_NEVER_PLANNED =
  "A Publishing Task's Plan and Definition of Done are The Office's; it never enters Planning.";

const ARROW = " → ";
const ELLIPSIS = "…";

const ADDED_BY_THE_OFFICE: StateChangeCause = {
  kind: "office",
  reason:
    "added it as the Initiative's Publishing Task, its Plan, Definition of Done and Pipeline confirmed.",
};

/**
 * "<Initiative> → <Project>", the Initiative's name cut at a word when the whole would pass a
 * title's length.
 */
export function publishingTaskTitle(
  initiative: Pick<Initiative, "name">,
  project: Pick<PublishingProject, "name">,
): string {
  const whole = `${initiative.name}${ARROW}${project.name}`;
  if (whole.length <= TITLE_LENGTH) return whole;
  const room = TITLE_LENGTH - ARROW.length - project.name.length - ELLIPSIS.length;
  if (room <= 0) return whole.slice(0, TITLE_LENGTH);
  const cut = initiative.name.slice(0, room + 1);
  const atWord = cut.lastIndexOf(" ");
  const name = (atWord > 0 ? cut.slice(0, atWord) : cut.slice(0, room)).trimEnd();
  return `${name}${ELLIPSIS}${ARROW}${project.name}`;
}

/** How Publish puts the Initiative's branch into the base branch, in the Project's mode. */
export function publishingModeWords(project: PublishingProject, branch: string): string {
  return project.publishingMode === "push-and-pull-request"
    ? `a pull request from ${branch} into ${project.baseBranch}`
    : `the base merged in with one merge commit, then ${project.baseBranch} fast-forwarded`;
}

/** The Office's own Plan: the branch, the base branch, the publishing mode, the Done Tasks. */
export function publishingTaskPlan(
  project: PublishingProject,
  { initiative, pipelineName, doneTasks }: PublishingGrounds,
): string {
  const branch = branchOf(initiative);
  return [
    `Publish the Initiative "${initiative.name}" in ${project.name}: its branch ${branch} holds the whole change, and this Task's worktree holds that branch itself.`,
    `The base branch is ${project.baseBranch}. Publish puts the branch into it by ${publishingModeWords(project, branch)}. A conflict goes to Resolve in this worktree, which takes in ${project.baseBranch} only.`,
    `The Task follows the Initiative's Pipeline, ${pipelineName}.`,
    [
      `The Initiative's Done Tasks in ${project.name}:`,
      ...doneTasks.map(({ title }) => `- ${title}`),
    ].join("\n"),
  ].join("\n\n");
}

/**
 * Every statement of the Done Tasks' Definitions of Done, each kept once in the order first met,
 * then that the whole change is in the base branch.
 */
export function publishingTaskDefinitionOfDone(
  doneTasks: readonly Pick<Task, "definitionOfDone">[],
  project: PublishingProject,
  branch: string,
): string[] {
  const statements = [...new Set(doneTasks.flatMap(({ definitionOfDone }) => definitionOfDone))];
  return [
    ...statements,
    `The whole change is in ${project.baseBranch} by ${publishingModeWords(project, branch)}.`,
  ];
}

/** The union of the Done Tasks' Files to change. */
export function publishingTaskFiles(doneTasks: readonly Pick<Task, "filesToChange">[]): string[] {
  return normalizedFilesToChange(doneTasks.flatMap(({ filesToChange }) => filesToChange));
}

/**
 * The Initiative's Publishing Task in the Project: Ready on the Initiative's Pipeline, its
 * Description the Initiative's outcome, its Plan, Definition of Done and Pipeline The Office's
 * and confirmed, as the Onboard Task's are.
 */
export function createPublishingTask(
  id: string,
  project: PublishingProject,
  grounds: PublishingGrounds,
  order: string,
  createdAt: Date,
): TaskChange<TaskCreated> {
  const { initiative, doneTasks } = grounds;
  const pipelineId = pipelineIn(initiative, project.id);
  if (pipelineId === undefined) {
    throw new Error(
      `The Initiative ${initiative.id} has no Pipeline in ${project.id} to publish by.`,
    );
  }
  return createTaskMadeFor(
    id,
    project.id,
    {
      madeFor: "publishing",
      title: publishingTaskTitle(initiative, project),
      description: initiative.outcome,
      pipelineId,
      plan: publishingTaskPlan(project, grounds),
      filesToChange: publishingTaskFiles(doneTasks),
      definitionOfDone: publishingTaskDefinitionOfDone(doneTasks, project, branchOf(initiative)),
      stateChangeCause: ADDED_BY_THE_OFFICE,
    },
    { order, createdBy: initiative.createdBy, initiativeId: initiative.id },
    createdAt,
  );
}

/**
 * The Projects that may get a Publishing Task now, before git is asked about their work: only for
 * an active Initiative whose other Tasks have all ended, each Project it has a Pipeline and its
 * branch in and no unfinished Publishing Task.
 */
export function publishingCandidates(initiative: Initiative, tasks: readonly Task[]): string[] {
  if (initiative.state !== "active") return [];
  const ordinary = tasks.filter((task) => !isPublishingTask(task));
  if (ordinary.length === 0 || ordinary.some((task) => !hasEnded(task))) return [];
  const publishing = new Set(
    tasks.filter((task) => isPublishingTask(task) && !hasEnded(task)).map((task) => task.projectId),
  );
  return initiative.branches
    .map(({ projectId }) => projectId)
    .filter(
      (projectId) => pipelineIn(initiative, projectId) !== undefined && !publishing.has(projectId),
    );
}

/** Of the candidates, the Projects whose branch holds unpublished work (`unpublished`). */
export function projectsToPublish(
  initiative: Initiative,
  tasks: readonly Task[],
  unpublished: ReadonlySet<string>,
): string[] {
  return publishingCandidates(initiative, tasks).filter((projectId) => unpublished.has(projectId));
}

/**
 * The Initiative's Pipeline in its Project, as the CTO's applied Proposal changed it, on a
 * Publishing Task not yet started (spec 2.1, "An Initiative's Pipeline"). Undefined when it
 * follows that Pipeline already; whether its Stages were edited for it is the caller's to judge.
 */
export function swapPublishingPipeline(
  task: Task,
  pipelineId: string,
): TaskChange<TaskPipelineConfirmed> | undefined {
  if (!isPublishingTask(task) || !NOT_STARTED_STATES.includes(task.state)) {
    throw new Error(`The Task ${task.id} isn't a Publishing Task not yet started.`);
  }
  if (task.pipelineId === pipelineId) return undefined;
  return {
    task: { ...task, pipelineId, proposedPipeline: undefined },
    event: new TaskPipelineConfirmed(task.id, pipelineId),
  };
}

/** The newest Done Publishing Task in the Project, whose published ref later ones compare to. */
export function lastPublishedBy(tasks: readonly Task[], projectId: string): Task | undefined {
  return tasks
    .filter(
      (task) => isPublishingTask(task) && task.projectId === projectId && task.state === "done",
    )
    .toSorted((one, other) => (other.endedAt?.getTime() ?? 0) - (one.endedAt?.getTime() ?? 0))[0];
}

/** The Project's Publishing Task that isn't Done or Dropped, if it has one. */
export function unfinishedPublishingTask(
  tasks: readonly Task[],
  projectId: string,
): Task | undefined {
  return tasks.find(
    (task) => isPublishingTask(task) && task.projectId === projectId && !hasEnded(task),
  );
}

/** The Initiative's Done Tasks in the Project, its Publishing Tasks left out. */
export function doneTasksIn(tasks: readonly Task[], projectId: string): Task[] {
  return tasks.filter(
    (task) => !isPublishingTask(task) && task.projectId === projectId && task.state === "done",
  );
}

function hasEnded(task: Pick<Task, "state">): boolean {
  return task.state === "done" || task.state === "dropped";
}

function branchOf(initiative: Initiative): string {
  if (initiative.shortName === undefined) {
    throw new Error(`The Initiative ${initiative.id} has no Short name to name its branch.`);
  }
  return initiativeBranchOf(initiative.shortName);
}

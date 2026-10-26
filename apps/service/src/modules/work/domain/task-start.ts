import type { Task } from "./task.js";
import type { TaskChange } from "./task-changes.js";
import { TaskStarted } from "./task-events.js";
import { TaskRefused } from "./task-refused.js";
import { STARTED_STATES, TASK_STATE_NAMES } from "./task-states.js";

/** A Stage of the Task's Pipeline as Start sees it: an Agent Stage names the Role that works it. */
export interface StartingStage {
  readonly name: string;
  readonly role?: string;
}

type AgentStartingStage = StartingStage & { readonly role: string };

/** The Office-wide limit on started Tasks until the user changes it in Settings (spec §9). */
export const DEFAULT_OFFICE_WIDE_LIMIT = 3;

/** How many Tasks a person may work at once; "none" means they only talk (spec §2.2). */
export type TaskLimit = number | "none";

/** The person filling a Role, as far as their Task limit goes. */
export interface StartingPerson {
  readonly name: string;
  readonly taskLimit: TaskLimit;
}

/** What Start weighs besides the Tasks already started, gathered from the other modules. */
export interface StartConditions {
  readonly projectName: string;
  /** The Stages of the Task's Pipeline, or undefined when the library has no such Pipeline. */
  readonly stages: readonly StartingStage[] | undefined;
  /** Who fills the Role of the first Agent Stage; undefined when nobody does or there is none. */
  readonly person: StartingPerson | undefined;
  /** The Office setting: how many Tasks may be started at once across The Office. */
  readonly officeWideLimit: number;
}

/** The Agent Stage whose Role's person the Task counts against, as the click-through counts. */
export function firstAgentStage(stages: readonly StartingStage[]): AgentStartingStage | undefined {
  return stages.find((stage): stage is AgentStartingStage => stage.role !== undefined);
}

/**
 * Every reason the Task can't start now (spec §9): the Project already has a Task started, the
 * Office-wide limit is reached, or the person of its first Agent Stage is at their Task limit.
 * Started Tasks are those In progress, Waiting on you or Paused. Empty when it can start.
 */
export function startProblems(
  task: Task,
  conditions: StartConditions,
  startedTasks: readonly Task[],
): string[] {
  if (task.state !== "ready") {
    return [`Only a Ready Task can start; this one is in ${TASK_STATE_NAMES[task.state]}.`];
  }
  if (!conditions.stages) return [`There is no Pipeline "${task.pipelineId}" in the library.`];
  const others = startedTasks.filter(
    (other) => other.id !== task.id && STARTED_STATES.includes(other.state),
  );
  return [
    ...projectProblems(task, conditions.projectName, others),
    ...officeWideLimitProblems(conditions.officeWideLimit, others),
    ...taskLimitProblems(firstAgentStage(conditions.stages), conditions.person, others),
  ];
}

/** Ready → In progress, counted against the first Agent Stage's person. Refuses with every reason. */
export function startTask(
  task: Task,
  conditions: StartConditions,
  startedTasks: readonly Task[],
): TaskChange<TaskStarted> {
  const problems = startProblems(task, conditions, startedTasks);
  if (problems.length > 0) throw new TaskRefused(problems);
  const personRole = conditions.stages && firstAgentStage(conditions.stages)?.role;
  return {
    task: { ...task, state: "in-progress", personRole },
    event: new TaskStarted(task.id, task.pipelineId),
  };
}

function projectProblems(task: Task, projectName: string, others: readonly Task[]): string[] {
  const started = others.find((other) => other.projectId === task.projectId);
  return started ? [`${projectName} already has a Task in progress: "${started.title}".`] : [];
}

function officeWideLimitProblems(limit: number, others: readonly Task[]): string[] {
  if (others.length < limit) return [];
  return [`The Office-wide limit is reached: ${others.length} of ${limit} desks are in use.`];
}

function taskLimitProblems(
  stage: AgentStartingStage | undefined,
  person: StartingPerson | undefined,
  others: readonly Task[],
): string[] {
  if (!stage) return [];
  if (!person) {
    return [`Hire a person for the ${stage.role} Role on People first: ${stage.name} needs one.`];
  }
  if (person.taskLimit === "none") {
    return [`${person.name} only talks (Task limit none), so can't work ${stage.name}.`];
  }
  const theirs = others.filter((other) => other.personRole === stage.role).length;
  return theirs >= person.taskLimit
    ? [`${person.name} is at the Task limit (${person.taskLimit}).`]
    : [];
}

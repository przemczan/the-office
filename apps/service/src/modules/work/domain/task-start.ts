import { capWaits, exceededCaps, type CapWaits, type UsageAtStart } from "./cap-waits.js";
import type { Task } from "./task.js";
import type { StateChangeCause } from "./state-change.js";
import { withStateChange, type TaskChange } from "./task-changes.js";
import { blockedProblems } from "./task-dependencies.js";
import { TaskStarted } from "./task-events.js";
import { FIRE_ALARM_ON } from "./fire-alarm.js";
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
  /** The Stages of the Task's Pipeline, or undefined when the library has no such Pipeline. */
  readonly stages: readonly StartingStage[] | undefined;
  /** Who fills the Role of the first Agent Stage; undefined when nobody does or there is none. */
  readonly person: StartingPerson | undefined;
  /** The Office setting: how many Tasks may be started at once across The Office. */
  readonly officeWideLimit: number;
  /** What the Task is expected to use, against the caps of the engines it spends on. */
  readonly usage: UsageAtStart;
}

/**
 * What Start reads in the same hold as the Task, so a second Start or a new blocker can't slip in
 * between the check and the save: every started Task (In progress, Waiting on you or Paused) and
 * the Tasks it waits for.
 */
export interface HeldAtStart {
  readonly startedTasks: readonly Task[];
  readonly blockers: readonly Task[];
  /** Whether the fire alarm is on, which holds every Start until the all clear (spec §2.8). */
  readonly fireAlarmOn: boolean;
}

/**
 * Why the Task can't start now, sorted as Start treats them (spec §2.1, "A queue for Start"): a
 * refusal (not Ready, a Task it waits for isn't Done, a vacant Role, a person who only talks) stops
 * Start; a wait (the fire alarm, the Office-wide limit, its person's Task limit, a cap it would
 * pass) only holds the Task until the all clear, a desk and its person are free, and the cap
 * allows it. Both are empty when it can start.
 */
export interface StartReasons {
  readonly refusals: readonly string[];
  readonly waits: readonly string[];
}

/** The Agent Stage whose Role's person the Task counts against, as the click-through counts. */
export function firstAgentStage(stages: readonly StartingStage[]): AgentStartingStage | undefined {
  return stages.find((stage): stage is AgentStartingStage => stage.role !== undefined);
}

/** Every reason the Task can't start now, the refusals apart from the waits. */
export function startReasons(
  task: Task,
  conditions: StartConditions,
  { startedTasks, blockers, fireAlarmOn }: HeldAtStart,
): StartReasons {
  if (task.state !== "ready") {
    return refusedFor(
      `Only a Ready Task can start; this one is in ${TASK_STATE_NAMES[task.state]}.`,
    );
  }
  if (!conditions.stages) {
    return refusedFor(`There is no Pipeline "${task.pipelineId}" in the library.`);
  }
  const others = startedTasks.filter(
    (other) => other.id !== task.id && STARTED_STATES.includes(other.state),
  );
  const stage = firstAgentStage(conditions.stages);
  return {
    refusals: [...blockedProblems(blockers), ...personRefusals(stage, conditions.person)],
    waits: [
      ...(fireAlarmOn ? [FIRE_ALARM_ON] : []),
      ...officeWideLimitWaits(conditions.officeWideLimit, others),
      ...taskLimitWaits(stage, conditions.person, others),
      ...capWaitsAtStart(conditions.usage).waits,
    ],
  };
}

/** What holds the Start for the caps it would pass. */
export function capWaitsAtStart(usage: UsageAtStart): CapWaits {
  return capWaits(exceededCaps(usage), usage.now);
}

/**
 * Ready → In progress, counted against the first Agent Stage's person: by the user's Start, or by
 * the queue as the Task's turn comes. Refuses with every reason.
 */
export function startTask(
  task: Task,
  conditions: StartConditions,
  held: HeldAtStart,
  by: StateChangeCause,
): TaskChange<TaskStarted> {
  const { refusals, waits } = startReasons(task, conditions, held);
  if (refusals.length > 0 || waits.length > 0) throw new TaskRefused([...refusals, ...waits]);
  const personRole = conditions.stages && firstAgentStage(conditions.stages)?.role;
  return withStateChange(
    {
      task: { ...task, state: "in-progress", personRole },
      event: new TaskStarted(task.id, task.pipelineId),
    },
    task,
    by,
  );
}

function refusedFor(reason: string): StartReasons {
  return { refusals: [reason], waits: [] };
}

function personRefusals(
  stage: AgentStartingStage | undefined,
  person: StartingPerson | undefined,
): string[] {
  if (!stage) return [];
  if (!person) {
    return [`Nobody fills the Role ${stage.name} needs: hire a person for it on People first.`];
  }
  return person.taskLimit === "none"
    ? [`${person.name} only talks (Task limit none), so can't work ${stage.name}.`]
    : [];
}

function officeWideLimitWaits(limit: number, others: readonly Task[]): string[] {
  if (others.length < limit) return [];
  const desks = limit === 1 ? "the only desk is" : `all ${limit} desks are`;
  return [`The Office-wide limit is reached: ${desks} in use.`];
}

function taskLimitWaits(
  stage: AgentStartingStage | undefined,
  person: StartingPerson | undefined,
  others: readonly Task[],
): string[] {
  if (!stage || !person || person.taskLimit === "none") return [];
  const theirs = others.filter((other) => other.personRole === stage.role).length;
  return theirs >= person.taskLimit
    ? [`${person.name} is at the Task limit (${person.taskLimit}).`]
    : [];
}

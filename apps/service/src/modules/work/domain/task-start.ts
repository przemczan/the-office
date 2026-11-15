import { DUTIES } from "../../people/index.js";
import { startWaitsForUsage, type UsageAtStart } from "./cap-waits.js";
import { hasPipeline, NO_PIPELINE_YET, type Task } from "./task.js";
import type { StateChangeCause } from "./state-change.js";
import { withStateChange, type TaskChange } from "./task-changes.js";
import { blockedProblems } from "./task-dependencies.js";
import { TaskStarted } from "./task-events.js";
import { FIRE_ALARM_ON } from "./fire-alarm.js";
import { INITIATIVE_PAUSED } from "./initiative-pause.js";
import { TaskRefused } from "./task-refused.js";
import { initiativeBranchGoneRefusal } from "./task-branch-base.js";
import { STARTED_STATES, TASK_STATE_NAMES } from "./task-states.js";
import { reasonsOf, type Wait } from "./wait.js";

/**
 * A Stage of the Task's Pipeline as Start sees it: an Agent Stage names the Role that works it, or
 * a duty, whose holder's Role `role` is then; none while nobody holds it.
 */
export interface StartingStage {
  readonly name: string;
  readonly role?: string;
  /** The key of the duty the Stage names, such as implements. */
  readonly duty?: string;
}

type AgentStartingStage = StartingStage & ({ readonly role: string } | { readonly duty: string });

/** The Office-wide limit on started Tasks until the user changes it in Settings (spec §9). */
export const DEFAULT_OFFICE_WIDE_LIMIT = 3;

/** How many Tasks a person may work at once; "none" means they only talk (spec §2.2). */
export type TaskLimit = number | "none";

/** The person filling a Role, as far as their Task limit goes. */
export interface StartingPerson {
  readonly name: string;
  readonly taskLimit: TaskLimit;
}

/** The Task's Project, as far as its Project limit goes. */
export interface StartingProject {
  readonly name: string;
  readonly projectLimit: number;
}

/**
 * Why the Task can't start from its Initiative's branch: the branch is gone from its Project, or
 * was never made there.
 */
export type InitiativeBranchProblem =
  | { readonly kind: "gone"; readonly branch: string }
  | { readonly kind: "not-made"; readonly reason: string };

/** What Start weighs besides the Tasks already started, gathered from the other modules. */
export interface StartConditions {
  /** The Stages of the Task's Pipeline, or undefined when the library has no such Pipeline. */
  readonly stages: readonly StartingStage[] | undefined;
  /** Who fills the Role of the first Agent Stage; undefined when nobody does or there is none. */
  readonly person: StartingPerson | undefined;
  /** The Office setting: how many Tasks may be started at once across The Office. */
  readonly officeWideLimit: number;
  /** The Task's Project; undefined when the Projects module no longer knows it. */
  readonly project: StartingProject | undefined;
  /** What the Task is expected to use, against the caps of the engines it spends on. */
  readonly usage: UsageAtStart;
  /**
   * Why a scheduled Office update or restart holds every Start, in the UI's words; undefined when
   * none is.
   */
  readonly scheduledExitWait: { readonly reason: string; readonly short: string } | undefined;
  /** Undefined when the Task starts from the base branch, or from its Initiative's branch there. */
  readonly initiativeBranch?: InitiativeBranchProblem;
  /** The Task's Pipeline when it is a Broken Project Pipeline and its Stages weren't edited for it. */
  readonly brokenPipeline?: BrokenPipelineAtStart;
}

/** A Broken Project Pipeline the Task would start on, with each reason it is Broken. */
export interface BrokenPipelineAtStart {
  readonly name: string;
  readonly reasons: readonly string[];
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
  /** Whether the Task's Initiative is paused, which holds its Start until it is resumed. */
  readonly initiativePaused: boolean;
}

/**
 * Why the Task can't start now, sorted as Start treats them (spec §2.1, "A queue for Start"): a
 * refusal (not Ready, a Broken Pipeline, a vacant Role, a person who only talks, its Initiative's
 * branch gone) stops Start; a wait (a Task it waits for not yet Done or Dropped, the fire alarm, its
 * Initiative's Pause, a scheduled Office update, the Office-wide limit, its Project limit, its
 * person's Task limit, a cap it would pass) only holds the Task until its blockers end, the all
 * clear, its Initiative's Resume, a desk, its Project and its person are free, and the cap allows
 * it. Both are empty when it can start.
 */
export interface StartReasons {
  readonly refusals: readonly string[];
  readonly waits: readonly Wait[];
}

/** The Agent Stage whose Role's person the Task counts against, as the click-through counts. */
export function firstAgentStage(stages: readonly StartingStage[]): AgentStartingStage | undefined {
  return stages.find(
    (stage): stage is AgentStartingStage => stage.role !== undefined || stage.duty !== undefined,
  );
}

/** Every reason the Task can't start now, the refusals apart from the waits. */
export function startReasons(
  task: Task,
  conditions: StartConditions,
  { startedTasks, blockers, fireAlarmOn, initiativePaused }: HeldAtStart,
): StartReasons {
  if (task.state !== "ready") {
    return refusedFor(
      `Only a Ready Task can start; this one is in ${TASK_STATE_NAMES[task.state]}.`,
    );
  }
  if (!hasPipeline(task)) return refusedFor(NO_PIPELINE_YET);
  const others = startedTasks.filter(
    (other) => other.id !== task.id && STARTED_STATES.includes(other.state),
  );
  const stage = conditions.stages && firstAgentStage(conditions.stages);
  return {
    refusals: [
      ...brokenPipelineRefusals(conditions),
      ...(conditions.stages
        ? personRefusals(stage, conditions.person)
        : [`There is no Pipeline "${task.pipelineId}" this Task's Project can follow.`]),
      ...initiativeBranchRefusals(task, conditions),
    ],
    waits: [
      ...blockedProblems(blockers).map((reason) => ({ reason, short: "Blocked" })),
      ...(fireAlarmOn ? [{ reason: FIRE_ALARM_ON, short: "Fire alarm on" }] : []),
      ...(initiativePaused ? [{ reason: INITIATIVE_PAUSED, short: "Initiative paused" }] : []),
      ...(conditions.scheduledExitWait ? [conditions.scheduledExitWait] : []),
      ...officeWideLimitWaits(conditions.officeWideLimit, others),
      ...projectLimitWaits(task, conditions.project, others),
      ...taskLimitWaits(stage, conditions.person, others),
      ...startWaitsForUsage(conditions.usage).waits,
    ],
  };
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
  if (refusals.length > 0 || waits.length > 0) {
    throw new TaskRefused([...refusals, ...reasonsOf(waits)]);
  }
  if (!hasPipeline(task)) throw new TaskRefused([NO_PIPELINE_YET]);
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

/** The duty's label, such as Implements. */
function dutyLabel(duty: string): string {
  return DUTIES.find(({ key }) => key === duty)?.label ?? duty;
}

function refusedFor(reason: string): StartReasons {
  return { refusals: [reason], waits: [] };
}

function personRefusals(
  stage: AgentStartingStage | undefined,
  person: StartingPerson | undefined,
): string[] {
  if (!stage) return [];
  if (stage.role === undefined && stage.duty !== undefined) {
    return [
      `Nobody holds ${dutyLabel(stage.duty)}, which ${stage.name} needs: choose who holds it in Settings › Duties first.`,
    ];
  }
  if (!person) {
    return [`Nobody fills the Role ${stage.name} needs: hire a person for it on People first.`];
  }
  return person.taskLimit === "none"
    ? [`${person.name} only talks (Task limit none), so can't work ${stage.name}.`]
    : [];
}

function brokenPipelineRefusals({ brokenPipeline, project }: StartConditions): string[] {
  if (!brokenPipeline) return [];
  const { name, reasons } = brokenPipeline;
  const where = project ? `${project.name}'s Pipelines` : "its Project's Pipelines";
  return [
    `${name} is Broken: ${reasons.join(" ")} Fix it in ${where}, or choose another Pipeline for the Task.`,
  ];
}

function initiativeBranchRefusals(task: Task, conditions: StartConditions): string[] {
  const problem = conditions.initiativeBranch;
  if (!problem) return [];
  if (problem.kind === "not-made") return [problem.reason];
  return [initiativeBranchGoneRefusal(problem.branch, conditions.project?.name ?? task.projectId)];
}

function officeWideLimitWaits(limit: number, others: readonly Task[]): Wait[] {
  if (others.length < limit) return [];
  const desks = limit === 1 ? "the only desk is" : `all ${limit} desks are`;
  return [
    {
      reason: `The Office-wide limit is reached: ${desks} in use.`,
      short: `Office-wide limit reached (${limit})`,
    },
  ];
}

/** Only the Project's own started Tasks count, so a full Project never holds another's Task. */
function projectLimitWaits(
  task: Task,
  project: StartingProject | undefined,
  others: readonly Task[],
): Wait[] {
  if (!project) return [];
  const started = others.filter((other) => other.projectId === task.projectId).length;
  if (started < project.projectLimit) return [];
  const verb = started === 1 ? "is" : "are";
  return [
    {
      reason: `The Project limit is reached: ${started} of ${project.name}'s Tasks ${verb} started.`,
      short: `Project limit reached (${project.projectLimit})`,
    },
  ];
}

function taskLimitWaits(
  stage: AgentStartingStage | undefined,
  person: StartingPerson | undefined,
  others: readonly Task[],
): Wait[] {
  if (stage?.role === undefined || !person || person.taskLimit === "none") return [];
  const theirs = others.filter((other) => other.personRole === stage.role).length;
  if (theirs < person.taskLimit) return [];
  return [
    {
      reason: `${person.name} is at the Task limit (${person.taskLimit}).`,
      short: `${person.name}'s Task limit reached (${person.taskLimit})`,
    },
  ];
}

import { FIRE_ALARM_ON } from "./fire-alarm.js";
import type { Initiative } from "./initiative.js";
import { isPublishingTask, type Task, type TaskState } from "./task.js";

/** Each state as the UI names it. */
export const TASK_STATE_NAMES: Readonly<Record<TaskState, string>> = {
  shaping: "Shaping",
  backlog: "Backlog",
  planning: "Planning",
  ready: "Ready",
  "in-progress": "In progress",
  "waiting-on-you": "Waiting on you",
  paused: "Paused",
  done: "Done",
  dropped: "Dropped",
};

/**
 * Where a Task may be moved from each state. Work only moves forward; Planning is optional, so a
 * Task whose Plan and Definition of Done the user wrote goes from Backlog to Ready (spec §2.1);
 * Waiting on you and Paused are side states of In progress and move among themselves; Dropped is
 * open until the Task ends. Nobody moves a Task back from Ready, so that isn't here: only saving a
 * change to its Plan or Definition of Done moves it to Backlog (`planning-changes.ts`). Nobody asks
 * for Shaping → Backlog either: only confirming the Initiative makes it (`initiative-changes.ts`).
 * The user's ways back aren't here either, each with rules of its own (below, "The ways back"):
 * Start over (Paused → Ready) and Reopen… (Dropped → Backlog or Ready).
 */
const NEXT_STATES: Readonly<Record<TaskState, readonly TaskState[]>> = {
  shaping: ["dropped"],
  backlog: ["planning", "ready", "dropped"],
  planning: ["ready", "dropped"],
  ready: ["in-progress", "dropped"],
  "in-progress": ["waiting-on-you", "paused", "done", "dropped"],
  "waiting-on-you": ["in-progress", "paused", "dropped"],
  paused: ["in-progress", "waiting-on-you", "dropped"],
  done: [],
  dropped: [],
};

/** What a Task in Shaping waits for, closing each refusal of what comes after it. */
export const CONFIRM_ITS_INITIATIVE = "confirm its Initiative first.";

/** States from which the user may still reorder a Task on the board: it hasn't started. */
export const NOT_STARTED_STATES: readonly TaskState[] = ["shaping", "backlog", "planning", "ready"];

/**
 * States of a started Task: Waiting on you and Paused keep its worktree and session, so they count
 * against the Task limits as In progress does (spec §9).
 */
export const STARTED_STATES: readonly TaskState[] = ["in-progress", "waiting-on-you", "paused"];

/** States of a Task neither Done nor Dropped, started or not. */
export const OPEN_STATES: readonly TaskState[] = [...NOT_STARTED_STATES, ...STARTED_STATES];

/**
 * States of the other Tasks a Start weighs: the started ones for the Task limits, the Overlaps and
 * the Daily caps' work in progress, the done ones as the Usage estimates' history.
 */
export const STATES_A_START_WEIGHS: readonly TaskState[] = [...STARTED_STATES, "done"];

/** Every reason the Task can't move to `to`; empty when it can or is already there. */
export function stateChangeProblems(task: Task, to: TaskState): string[] {
  const move = moveProblems(task, to);
  if (move.length > 0 || task.state === to) return move;
  return to === "ready" ? readyProblems(task) : [];
}

/** Why the state rules refuse the move itself, whatever the Task's record holds. */
export function moveProblems(task: Task, to: TaskState): string[] {
  if (task.state === to || NEXT_STATES[task.state].includes(to)) return [];
  const refusal = `A Task in ${TASK_STATE_NAMES[task.state]} can't move to ${TASK_STATE_NAMES[to]}`;
  return [task.state === "shaping" ? `${refusal}: ${CONFIRM_ITS_INITIATIVE}` : `${refusal}.`];
}

/** One condition of Ready, as the "Before Ready" checklist names it; `problems` is empty once met. */
export interface ReadinessLine {
  readonly part: "plan" | "definition-of-done" | "pipeline" | "decisions";
  readonly label: string;
  readonly problems: readonly string[];
}

/**
 * Ready requires a Plan and a Definition of Done, each confirmed by the user or by auto mode on
 * their behalf, a Pipeline chosen with no proposal left open (the user takes or declines it,
 * keeping the Pipeline the Task follows) and no Decision on the Task open (spec §2.1). The one list of conditions: the refusals and the checklist
 * both come from it. Mark Ready confirming the parts as they stand (`markTaskReady`) weighs only
 * the lines of `CONDITIONS_KEPT_WHEN_CONFIRMING`.
 */
export function readinessLines(task: Task, openDecisions: number): ReadinessLine[] {
  return [
    { part: "plan", label: "Plan confirmed", problems: planProblems(task) },
    {
      part: "definition-of-done",
      label: "Definition of Done confirmed",
      problems: definitionOfDoneProblems(task),
    },
    {
      part: "pipeline",
      label: "Pipeline chosen",
      problems: pipelineProblems(task),
    },
    {
      part: "decisions",
      label: "No Decision open",
      problems: openDecisionProblems(openDecisions),
    },
  ];
}

/** The conditions that still hold when the user marks a Task Ready confirming its parts as they stand. */
export const CONDITIONS_KEPT_WHEN_CONFIRMING: readonly ReadinessLine["part"][] = [
  "pipeline",
  "decisions",
];

function planProblems(task: Task): string[] {
  if (task.plan.trim() === "") return ["A Task needs a Plan before it can be Ready."];
  return task.planConfirmed ? [] : ["Confirm the Plan before the Task can be Ready."];
}

function definitionOfDoneProblems(task: Task): string[] {
  if (task.definitionOfDone.length === 0) {
    return ["A Task needs a Definition of Done before it can be Ready."];
  }
  return task.definitionOfDoneConfirmed
    ? []
    : ["Confirm the Definition of Done before the Task can be Ready."];
}

function pipelineProblems(task: Task): string[] {
  if (task.proposedPipeline) {
    return ["Take or decline the proposed Pipeline before the Task can be Ready."];
  }
  return task.pipelineId === undefined ? ["Choose a Pipeline before the Task can be Ready."] : [];
}

/** Every reason the Task's own record keeps it from Ready; Decisions are asked of Work's ports. */
function readyProblems(task: Task): string[] {
  return readinessLines(task, 0).flatMap(({ problems }) => problems);
}

/** Ready also waits for every Decision on the Task to be answered (spec §2.1, the user's answer). */
export function openDecisionProblems(openDecisions: number): string[] {
  if (openDecisions === 0) return [];
  return [
    openDecisions === 1
      ? "Answer the open Decision before the Task can be Ready."
      : `Answer the ${openDecisions} open Decisions before the Task can be Ready.`,
  ];
}

/*
 * The ways back (spec 2.1.3, "Work moves forward"; spec 2.4.5): Restart from… and Start over, for a
 * Task Paused by the user's own Pause or Stop, and Reopen…, for a Dropped Task. Each is the user's
 * alone, never an Office action. Restart from… goes on In progress as Resume does; Start over takes
 * the Task to Ready, its Plan, Definition of Done and Pipeline kept as confirmed; Reopen… takes it to
 * Backlog or Ready. The changes themselves are `restartTask`, `startTaskOver` and `reopenTask`.
 */

/** Why a single Resume, Restart from… or Start over is refused while the Task's Initiative is paused. */
export const INITIATIVE_PAUSED_RESUME = "The Initiative is paused: resume it to go on.";

/** Why a Task the fire alarm paused isn't resumed, restarted or started over: the all clear does it. */
export const ALARM_HOLDS_THE_TASK = `${FIRE_ALARM_ON} The Task resumes with the all clear.`;

/** Why a Restart from… waits while the fire alarm holds every walk (ASAP). */
export const ALARM_HOLDS_RESTART = `${FIRE_ALARM_ON} Restart it after the all clear.`;

/** Why a Task its engine's usage window paused isn't restarted or started over: the reset resumes it. */
export const USAGE_WINDOW_HOLDS_THE_TASK =
  "Its engine's usage window is used up: the Task resumes at its reset.";

/**
 * Why Pipelines doesn't reset the branch of a Task a Publish Stage pushed or opened a pull request
 * of: the next Publish pushes without force, onto the branch and pull request as they are.
 */
export const LEFT_THE_WORKSTATION =
  "Its work has left the workstation, so its branch isn't reset: the next Publish pushes onto the same branch and pull request.";

/** What holds a Paused Task beyond its own Pause or Stop, read as it stays, for a way back. */
export interface WayBackHolds {
  /** Whether its Initiative is paused. */
  readonly initiativePaused: boolean;
  /** Whether the fire alarm holds a walk of the Task now (`holdsResume`). */
  readonly alarmHoldsResume: boolean;
}

/**
 * Why the user can't Restart from… the Task now: it isn't Paused by their own Pause or Stop, the fire
 * alarm, its engine's usage window or its paused Initiative holds it, or the alarm holds every walk.
 * Empty when they can.
 */
export function restartProblems(task: Task, holds: WayBackHolds): string[] {
  if (task.state !== "paused") return [notPausedWords(task, "restarted")];
  const held = heldProblems(task, holds);
  if (held.length > 0) return held;
  return holds.alarmHoldsResume ? [ALARM_HOLDS_RESTART] : [];
}

/** Why a Publishing Task isn't started over: its branch is the Initiative's, pushed as it goes. */
export const PUBLISHING_TASK_NOT_STARTED_OVER =
  "A Publishing Task isn't started over: its branch is its Initiative's, pushed as it goes. Use Restart from… instead.";

/** Why a Conflict resolution Task isn't started over: its branch is another Task's, already pushed. */
export const CONFLICT_RESOLUTION_NOT_STARTED_OVER =
  "A Conflict resolution Task isn't started over: it works on the branch of the Task whose pull request has the conflicts. Use Restart from… instead.";

/**
 * Why the user can't Start over the Task now, as Work judges it: it isn't Paused by their own Pause
 * or Stop; it is a Publishing or a Conflict resolution Task, whose branch isn't its own to reset;
 * or the fire alarm, its engine's usage window or its paused Initiative holds it. The alarm alone
 * doesn't refuse it, as a Ready Task doesn't walk. Pipelines' refusals come on top.
 */
export function startOverProblems(task: Task, holds: WayBackHolds): string[] {
  if (task.state !== "paused") return [notPausedWords(task, "started over")];
  if (task.madeFor === "publishing") return [PUBLISHING_TASK_NOT_STARTED_OVER];
  if (task.madeFor === "resolve-conflicts") return [CONFLICT_RESOLUTION_NOT_STARTED_OVER];
  return heldProblems(task, holds);
}

function notPausedWords(task: Task, verb: string): string {
  return `Only a Paused Task can be ${verb}; this one is in ${TASK_STATE_NAMES[task.state]}.`;
}

function heldProblems(task: Task, { initiativePaused }: WayBackHolds): string[] {
  if (initiativePaused || task.pausedBy === "initiative") return [INITIATIVE_PAUSED_RESUME];
  if (task.pausedBy === "alarm") return [ALARM_HOLDS_THE_TASK];
  if (task.pausedBy === "usage-window") return [USAGE_WINDOW_HOLDS_THE_TASK];
  return [];
}

/** Where Reopen… takes a Dropped Task, as the user asks. */
export type ReopenTo = "backlog" | "ready";

/**
 * Where Start over takes a Task, as the user asks: Ready, its Plan, Definition of Done and Pipeline
 * kept as confirmed, or Backlog, to plan it again (spec 2.4.5, "Start over").
 */
export type StartOverTo = "backlog" | "ready";

/** What a Reopen… weighs beyond the Task: its Initiative and that Initiative's Tasks, as they stay. */
export interface ReopenGrounds {
  /** The Task's Initiative; undefined for a Task in none. */
  readonly initiative: Pick<Initiative, "state"> | undefined;
  /** The Initiative's Tasks, the Task among them; empty for a Task in none. */
  readonly initiativeTasks: readonly Task[];
}

/** Why a Publishing Task isn't reopened: The Office adds another when it is needed. */
export const PUBLISHING_TASK_NOT_REOPENED =
  "A Publishing Task isn't reopened: The Office adds a new one once the Initiative's other Tasks have ended.";

/** Why a Conflict resolution Task isn't reopened: another is made from the pull request's Task. */
export const CONFLICT_RESOLUTION_NOT_REOPENED =
  "A Conflict resolution Task isn't reopened: resolve the conflicts again from the Task whose pull request has them.";

/** Why another Task The Office made for its own work isn't reopened. */
export const OFFICE_TASK_NOT_REOPENED =
  "A Task The Office made for its own work isn't reopened: start a new one where The Office offers it.";

/**
 * Why the user can't Reopen… the Task to `to`: it isn't Dropped; it is a Task The Office made (a
 * Publishing Task, a Conflict resolution Task, an Off-board Task); its Initiative is Done or
 * Dropped, or active with its Publishing Task in the Task's Project started; and, to Ready, its
 * Plan, Definition of Done and Pipeline aren't all confirmed, or its Initiative is still being
 * shaped. Empty when they can.
 */
export function reopenProblems(task: Task, to: ReopenTo, grounds: ReopenGrounds): string[] {
  if (task.state !== "dropped") {
    return [`Only a Dropped Task can be reopened; this one is in ${TASK_STATE_NAMES[task.state]}.`];
  }
  const madeFor = madeForProblems(task);
  if (madeFor.length > 0) return madeFor;
  const { initiative } = grounds;
  if (initiative?.state === "done" || initiative?.state === "dropped") {
    const name = initiative.state === "done" ? "Done" : "Dropped";
    return [`Its Initiative is ${name}, so its Tasks stay as they ended.`];
  }
  if (initiative?.state === "active") {
    const started = grounds.initiativeTasks.find(
      (each) =>
        isPublishingTask(each) &&
        each.projectId === task.projectId &&
        each.state !== "dropped" &&
        !NOT_STARTED_STATES.includes(each.state),
    );
    if (started) {
      return [
        `Its Initiative's Publishing Task "${started.title}" has started in its Project, so its Tasks there stay as they ended.`,
      ];
    }
  }
  if (to === "backlog") return [];
  if (initiative?.state === "shaping") {
    return [
      `A Task of an Initiative being shaped is reopened in Shaping: ${CONFIRM_ITS_INITIATIVE}`,
    ];
  }
  return readyProblems(task);
}

function madeForProblems(task: Task): string[] {
  switch (task.madeFor) {
    case undefined:
      return [];
    case "publishing":
      return [PUBLISHING_TASK_NOT_REOPENED];
    case "resolve-conflicts":
      return [CONFLICT_RESOLUTION_NOT_REOPENED];
    default:
      return [OFFICE_TASK_NOT_REOPENED];
  }
}

/** Whether one of the ways back is offered now, and why not when it isn't. */
export interface WayBackOffer {
  readonly offered: boolean;
  /** Why it isn't offered; null when it is, and when the Task's state has no such way back. */
  readonly why: string | null;
}

/** Each way back as the Task page offers it. */
export interface WaysBack {
  readonly restart: WayBackOffer;
  readonly startOver: WayBackOffer;
  readonly reopen: WayBackOffer;
  readonly reopenToReady: WayBackOffer;
  /** Whether Start over and Reopen… may reset the branch of a Task that had started. */
  readonly resetBranch: WayBackOffer;
}

/** What the ways back of a Task are weighed on, read as it stays. */
export interface WaysBackGrounds extends ReopenGrounds {
  readonly holds: WayBackHolds;
  /** Pipelines' refusals of a Start over of its work. */
  readonly startOverRefusals: readonly string[];
  /** Pipelines' refusals of resetting its branch as it starts over, such as `LEFT_THE_WORKSTATION`. */
  readonly branchResetRefusals: readonly string[];
  /** Whether the Task had started, so a Reopen… starts it over and weighs Pipelines' refusals. */
  readonly hadStarted: boolean;
}

/**
 * The Task's ways back: Restart from… and Start over for a Paused Task, Reopen… to Backlog or to
 * Ready for a Dropped one, and the reset of the branch of one that had started, each offered or why
 * not. One whose state has no such way back is not offered, with no reason (null): the page doesn't
 * show it at all.
 */
export function waysBackOf(task: Task, grounds: WaysBackGrounds): WaysBack {
  const notHere: WayBackOffer = { offered: false, why: null };
  const paused = task.state === "paused";
  const dropped = task.state === "dropped";
  const reopenRefusals = grounds.hadStarted ? grounds.startOverRefusals : [];
  return {
    restart: paused ? offerOf(restartProblems(task, grounds.holds)) : notHere,
    startOver: paused
      ? offerOf([...startOverProblems(task, grounds.holds), ...grounds.startOverRefusals])
      : notHere,
    resetBranch:
      (paused || dropped) && grounds.hadStarted ? offerOf(grounds.branchResetRefusals) : notHere,
    reopen: dropped
      ? offerOf([...reopenProblems(task, "backlog", grounds), ...reopenRefusals])
      : notHere,
    reopenToReady: dropped
      ? offerOf([...reopenProblems(task, "ready", grounds), ...reopenRefusals])
      : notHere,
  };
}

function offerOf(problems: readonly string[]): WayBackOffer {
  return problems.length === 0
    ? { offered: true, why: null }
    : { offered: false, why: problems.join(" ") };
}

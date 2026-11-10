import { READ_ONLY_SHELL_RULE } from "../../engine/index.js";
import type { Initiative } from "./initiative.js";
import type { InitiativeChange } from "./initiative-changes.js";
import { InitiativePlanningStarted } from "./initiative-events.js";
import { InitiativeRefused } from "./initiative-refused.js";
import {
  commandLines,
  pipelineLibraryLines,
  type PlanningPipeline,
  type PlanningProject,
} from "./planning.js";
import type { Task, TaskState } from "./task.js";
import { startPlanningTask, type TaskChange } from "./task-changes.js";
import type { TaskStateChanged } from "./task-events.js";
import { TaskRefused } from "./task-refused.js";
import { TASK_STATE_NAMES } from "./task-states.js";

/*
 * Plan the Initiative (spec §2.1): one planning Thread with the Planner on an active Initiative,
 * which plans its Backlog Tasks in the order its own dependencies set, moving each to Planning as
 * its turn comes (start_planning) and writing each one's parts by its Task id.
 */

export const INITIATIVE_PLANNING_THREAD_TITLE = "Planning the Initiative";

export const INITIATIVE_PLANNING_OPENING =
  "Plan this Initiative's Tasks in Backlog, as your Brief lists them, in the order their blockers set. The user has nothing more to add yet.";

/**
 * What the Planner does in an Initiative's planning Thread, after their card's instructions. The
 * same for every session, so it stays in the cached prefix; worded for an engine with subagents
 * and for one without, so no engine needs telling apart.
 */
export const INITIATIVE_PLANNING_INSTRUCTIONS = `In this Thread you plan an Initiative's Tasks in Backlog, one after another or several at once, without the user. You read each Project's base branch; you change no file, and ${READ_ONLY_SHELL_RULE}. With The Office's tools you read its records of Projects, people, Tasks, Ideas and Initiatives and any of their Attachments, and read_initiative reads this Initiative as it stands.

Plan the Tasks in dependency order: a Task's turn comes once every Task it waits for inside the Initiative is planned, Ready or beyond, or Dropped; blockers outside the Initiative don't set the order. When a Task's turn comes, move it to Planning with start_planning, giving its Task id.

If you have subagents (an Agent or a Task tool), hand each Task's research and drafting to one, and run the Tasks whose blockers are planned in parallel. Tell each subagent to read the Task's record and the base branches it needs, to write nothing with The Office's tools, and to return the Plan (how it will be done, in plain words whoever implements it can follow) with the files and folders it expects to change, the Definition of Done (what must be true when it is done, one statement each that can be checked), the Pipeline that fits from your Brief's library and why, a few Tags, and its estimate of the tokens the whole Pipeline will use. Without subagents, plan the Tasks one after another yourself.

You write each Task's parts yourself, naming it by its Task id: write_plan with its files to change and the token estimate, write_definition_of_done, propose_pipeline and write_tags, reusing Tags already in use where they fit. Then call mark_planned for it; your Brief says what follows.

When a Task needs an answer from the user, leave it in Planning or Backlog unplanned, and leave every Task that waits for it. Plan the rest. End your turn by saying which Tasks you planned, and which you left and why.`;

/** States in which a Task is planned enough for the Tasks waiting for it to be planned. */
const PLANNED_STATES: readonly TaskState[] = [
  "ready",
  "in-progress",
  "waiting-on-you",
  "paused",
  "done",
];

/**
 * Why Plan the Initiative can't open a planning Thread: the Initiative isn't active, none of its
 * Tasks is in Backlog, or one is still being planned in an earlier planning Thread. That a Planner
 * is hired is checked by the caller.
 */
export function initiativePlanningProblems(
  initiative: Initiative,
  tasks: readonly Task[],
): string[] {
  if (initiative.state !== "active") {
    return [
      `Only an active Initiative is planned; this one is ${initiative.state === "shaping" ? "being shaped: confirm it first" : initiative.state}.`,
    ];
  }
  const stillPlanning = tasks.find(isBeingPlannedInItsInitiative);
  if (stillPlanning) {
    return [
      `"${stillPlanning.title}" is still being planned in the earlier planning Thread (Thread ${stillPlanning.initiativePlanningThreadId}). Wait until it is marked planned there, or confirm it yourself.`,
    ];
  }
  if (!tasks.some(({ state }) => state === "backlog")) {
    return ["None of the Initiative's Tasks is in Backlog: nothing is left to plan."];
  }
  return [];
}

/**
 * Plan the Initiative: its new planning Thread `threadId` becomes the one that plans its Tasks, in
 * auto mode or not, kept before the Thread opens so its first session's Brief and tools find it.
 * Refused with the reasons of `initiativePlanningProblems`.
 */
export function startInitiativePlanning(
  initiative: Initiative,
  tasks: readonly Task[],
  threadId: string,
  autoMode: boolean,
): InitiativeChange<InitiativePlanningStarted> {
  const problems = initiativePlanningProblems(initiative, tasks);
  if (problems.length > 0) throw new InitiativeRefused(problems);
  return {
    initiative: { ...initiative, planningThreadId: threadId, planningAutoMode: autoMode },
    event: new InitiativePlanningStarted(initiative.id, threadId, autoMode),
  };
}

/** In Planning in its Initiative's planning Thread, not yet marked planned. */
function isBeingPlannedInItsInitiative(task: Task): boolean {
  return (
    task.state === "planning" &&
    task.initiativePlanningThreadId !== undefined &&
    !task.markedPlanned
  );
}

/**
 * start_planning in the Initiative's planning Thread `threadId`: Backlog → Planning for one of its
 * Tasks whose blockers inside the Initiative are planned, in the Initiative's auto mode, the Task
 * then planned in that Thread. Refused with every reason; undefined when it is in Planning there.
 */
export function startPlanningInInitiative(
  initiative: Initiative,
  task: Task,
  tasks: readonly Task[],
  threadId: string,
): TaskChange<TaskStateChanged> | undefined {
  if (initiative.planningThreadId !== threadId) {
    throw new InitiativeRefused([
      "Only the Initiative's latest planning Thread moves its Tasks to Planning; this Thread is an earlier one.",
    ]);
  }
  if (task.initiativeId !== initiative.id) {
    throw new TaskRefused([`"${task.title}" isn't one of this Initiative's Tasks.`]);
  }
  if (task.state === "planning" && task.initiativePlanningThreadId === threadId) return undefined;
  const problems = [
    ...(task.state === "backlog"
      ? []
      : [
          `"${task.title}" is in ${TASK_STATE_NAMES[task.state]}; only a Task in Backlog is moved to Planning.`,
        ]),
    ...unplannedBlockers(task, tasks).map(
      (blocker) =>
        `"${task.title}" waits for "${blocker.title}" (Task ${blocker.id}), which isn't planned yet: plan it first.`,
    ),
  ];
  if (problems.length > 0) throw new TaskRefused(problems);
  return startPlanningTask(task, initiative.planningAutoMode, { kind: "initiative", threadId });
}

/** The Tasks inside its Initiative it waits for that are neither planned, Ready or beyond, nor Dropped. */
export function unplannedBlockers(task: Task, tasks: readonly Task[]): Task[] {
  const inInitiative = new Map(
    tasks.filter(({ initiativeId }) => initiativeId === task.initiativeId).map((t) => [t.id, t]),
  );
  return task.blockedBy
    .map((id) => inInitiative.get(id))
    .filter((blocker): blocker is Task => blocker !== undefined && !isPlanned(blocker));
}

function isPlanned(task: Task): boolean {
  if (task.state === "dropped" || PLANNED_STATES.includes(task.state)) return true;
  return task.state === "planning" && task.markedPlanned;
}

/** A Project the Initiative spans, as its planning Brief names it. */
export interface InitiativePlanningProject extends PlanningProject {
  readonly id: string;
}

/** What an Initiative's planning Brief is assembled from, with no model call. */
export interface InitiativePlanningRecord {
  readonly initiative: Initiative;
  /** Its record as every session reads it: outcome, Tasks, dependencies and Attachments. */
  readonly record: string;
  readonly tasks: readonly Task[];
  readonly projects: readonly InitiativePlanningProject[];
  readonly pipelines: readonly PlanningPipeline[];
}

/**
 * An Initiative's planning Thread's Brief (spec §2.5): its record, the Backlog Tasks to plan with
 * their blockers inside it, the Projects it spans with their base branches and commands, the
 * Pipeline library and whether it is planned in auto mode.
 */
export function initiativePlanningBrief({
  initiative,
  record,
  tasks,
  projects,
  pipelines,
}: InitiativePlanningRecord): string {
  return [
    "You are planning an Initiative's Tasks, in its planning Thread.",
    record,
    toPlanSection(tasks, projects),
    unfinishedSection(initiative, tasks),
    projectsSection(projects),
    `## The Pipelines\n\nPropose the one each Task's Definition of Done needs with propose_pipeline:\n\n${pipelineLibraryLines(pipelines).join("\n")}`,
    autoModeSection(initiative.planningAutoMode),
  ]
    .filter((section) => section !== undefined)
    .join("\n\n");
}

function toPlanSection(
  tasks: readonly Task[],
  projects: readonly InitiativePlanningProject[],
): string {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const projectName = (id: string) => projects.find((project) => project.id === id)?.name ?? id;
  const lines = tasks
    .filter(({ state }) => state === "backlog")
    .map((task) => {
      const blockers = task.blockedBy
        .map((id) => byId.get(id))
        .filter((blocker) => blocker !== undefined)
        .map(
          (blocker) =>
            `"${blocker.title}" (Task ${blocker.id}, ${TASK_STATE_NAMES[blocker.state]})`,
        );
      const waits =
        blockers.length === 0
          ? "waits for no Task in the Initiative"
          : `waits for ${blockers.join(", ")}`;
      return `- "${task.title}" (Task ${task.id}), in the Project ${projectName(task.projectId)}: ${waits}.`;
    });
  if (lines.length === 0) return "## The Tasks to plan\n\nNone of its Tasks is in Backlog now.";
  return `## The Tasks to plan\n\nIts Tasks in Backlog, each with the Tasks inside the Initiative it waits for:\n\n${lines.join("\n")}`;
}

/**
 * The Tasks this Thread moved to Planning and hasn't marked planned, for a fresh session to carry
 * on with: the earlier session's context, and with it how far it got, is gone.
 */
function unfinishedSection(initiative: Initiative, tasks: readonly Task[]): string | undefined {
  const unfinished = tasks.filter(
    (task) =>
      isBeingPlannedInItsInitiative(task) &&
      task.initiativePlanningThreadId === initiative.planningThreadId,
  );
  if (unfinished.length === 0) return undefined;
  const lines = unfinished.map(({ id, title }) => `- "${title}" (Task ${id})`);
  return `## Being planned here\n\nThis Thread moved these Tasks to Planning and hasn't marked them planned yet: read each with read_task, finish what its parts lack and call mark_planned for it.\n\n${lines.join("\n")}`;
}

function projectsSection(projects: readonly InitiativePlanningProject[]): string {
  const parts = projects.map(
    ({ id, name, baseBranch, commands }) =>
      `### ${name} (${id})\n\nBase branch ${baseBranch}, checked out where The Projects below say. Its commands:\n\n${commandLines(commands).join("\n")}`,
  );
  return `## The Projects it spans\n\n${parts.join("\n\n")}`;
}

function autoModeSection(autoMode: boolean): string {
  return autoMode
    ? "## Auto mode\n\nOn: once you mark a Task planned with mark_planned, The Office confirms its Plan, Definition of Done and proposed Pipeline and marks it Ready."
    : "## Auto mode\n\nOff: once you mark a Task planned with mark_planned, it waits in Planning for the user to confirm its Plan, Definition of Done and Pipeline and mark it Ready.";
}

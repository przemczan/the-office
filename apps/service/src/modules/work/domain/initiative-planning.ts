import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { READ_ONLY_SHELL_RULE } from "../../engine/index.js";
import type { PromptTexts } from "../../prompt-templates/index.js";
import type { Author } from "./author.js";
import type { Initiative } from "./initiative.js";
import type { InitiativeChange } from "./initiative-changes.js";
import { InitiativePlanningStarted } from "./initiative-events.js";
import { InitiativeRefused } from "./initiative-refused.js";
import {
  bugDetailsWords,
  commandLines,
  defaultPipelineWords,
  kindValues,
  pipelineGroups,
  type PlanningPipeline,
  type PlanningProject,
} from "./planning.js";
import { PUBLISHING_TASK_NEVER_PLANNED } from "./publishing-task.js";
import { flagField, renderedText } from "./rendered-text.js";
import { isPublishingTask, type Task, type TaskKind, type TaskState } from "./task.js";
import { startPlanningTask, withStateChange, type TaskChange } from "./task-changes.js";
import { TaskRewrittenInInitiative, TaskStateChanged } from "./task-events.js";
import { TaskRefused } from "./task-refused.js";
import { TASK_STATE_NAMES } from "./task-states.js";
import { initiativePlanningOpenedBy } from "./who-asked.js";
import {
  INITIATIVE_PLANNING_AFTER_RESTART_OPENING,
  INITIATIVE_PLANNING_BRIEF,
  INITIATIVE_PLANNING_INSTRUCTIONS,
  INITIATIVE_PLANNING_OPENING,
} from "./work-prompt-templates.js";

/*
 * Plan the Initiative (spec §2.1): one planning Thread with the Planner on an active Initiative,
 * which plans its Backlog Tasks in the order its own dependencies set, moving each to Planning as
 * its turn comes (start_planning) and writing each one's parts by its Task id.
 */

export const INITIATIVE_PLANNING_THREAD_TITLE = "Planning the Initiative";

/**
 * What the planner is woken with in an Initiative's planning Thread that a restart of The Office
 * cut short (spec §2.4), as `planningAfterRestartOpening` is in a Task's.
 */
export function initiativePlanningAfterRestartOpening(prompts: PromptTexts): string {
  return renderedText(prompts, INITIATIVE_PLANNING_AFTER_RESTART_OPENING, {});
}

export function initiativePlanningOpening(prompts: PromptTexts): string {
  return renderedText(prompts, INITIATIVE_PLANNING_OPENING, {});
}

/**
 * What the Planner does in an Initiative's planning Thread, after their card's instructions. The
 * same for every session, so it stays in the cached prefix; worded for an engine with subagents
 * and for one without, so no engine needs telling apart.
 */
export function initiativePlanningInstructions(prompts: PromptTexts): string {
  return renderedText(prompts, INITIATIVE_PLANNING_INSTRUCTIONS, {
    readOnlyShellRule: READ_ONLY_SHELL_RULE,
  });
}

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
 * Tasks is in Backlog, or one is still being planned in an earlier planning Thread. That someone
 * holds Plans is checked by the caller.
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

/** How a new planning Thread on an Initiative is started, and by whom. */
export interface InitiativePlanningStart {
  readonly threadId: string;
  readonly autoMode: boolean;
  /** Opened by Plan with…: the planner waits for the user's first message on how to plan it. */
  readonly withUser: boolean;
  readonly by: Author;
}

/**
 * Plan the Initiative, or Plan with…: its new planning Thread `threadId` becomes the one that plans
 * its Tasks, in auto mode or not, kept before the Thread opens so its first session's Brief and
 * tools find it, with `by`, who asked for it. Refused with the reasons of
 * `initiativePlanningProblems`.
 */
export function startInitiativePlanning(
  initiative: Initiative,
  tasks: readonly Task[],
  { threadId, autoMode, withUser, by }: InitiativePlanningStart,
): InitiativeChange<InitiativePlanningStarted> {
  const problems = initiativePlanningProblems(initiative, tasks);
  if (problems.length > 0) throw new InitiativeRefused(problems);
  return {
    initiative: {
      ...initiative,
      planningThreadId: threadId,
      planningThreadIds: [...initiative.planningThreadIds, threadId],
      planningAutoMode: autoMode,
      planningWithUser: withUser,
      planningStartedBy: by,
    },
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
 * then planned in that Thread, moved `by` the person planning it. Refused with every reason;
 * undefined when it is in Planning there.
 */
export function startPlanningInInitiative(
  initiative: Initiative,
  task: Task,
  tasks: readonly Task[],
  threadId: string,
  by: Author,
): TaskChange<TaskStateChanged> | undefined {
  if (initiative.planningThreadId !== threadId) {
    throw new InitiativeRefused([
      "Only the Initiative's latest planning Thread moves its Tasks to Planning; this Thread is an earlier one.",
    ]);
  }
  if (task.initiativeId !== initiative.id) {
    throw new TaskRefused([`"${task.title}" isn't one of this Initiative's Tasks.`]);
  }
  if (isPublishingTask(task)) throw new TaskRefused([PUBLISHING_TASK_NEVER_PLANNED]);
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
  return startPlanningTask(task, initiative.planningAutoMode, { kind: "initiative", threadId, by });
}

/** The Initiative's planning Thread a part is rewritten from, and the Thread that is its latest. */
export interface RewritingThread {
  readonly initiativeId: string;
  readonly threadId: string;
}

/**
 * Why the Planner can't rewrite an already planned Task from the Initiative's planning Thread
 * (spec §2.1): only a Ready Task of the Initiative, or one in Planning marked planned in an earlier
 * planning Thread of it, is rewritten. A Task that has started or is Dropped, or that is planned in
 * its own planning Thread, never is: the Planner opens a Decision on it instead.
 */
export function rewritingProblems(
  task: Task,
  { initiativeId, threadId }: RewritingThread,
): string[] {
  if (task.initiativeId !== initiativeId) {
    return [`"${task.title}" isn't one of this Initiative's Tasks.`];
  }
  if (isPublishingTask(task)) return [PUBLISHING_TASK_NEVER_PLANNED];
  if (task.state === "ready") return [];
  if (task.state === "planning") {
    if (task.initiativePlanningThreadId === undefined) {
      return [
        `"${task.title}" is being planned in its own planning Thread and is never rewritten from here: open a Decision on it saying what changed and what you recommend.`,
      ];
    }
    if (task.initiativePlanningThreadId !== threadId && !task.markedPlanned) {
      return [`"${task.title}" is still being planned in an earlier planning Thread.`];
    }
    return [];
  }
  if (task.state === "backlog") {
    return [`"${task.title}" is in Backlog: move it to Planning with start_planning first.`];
  }
  if (task.state === "shaping")
    return [`"${task.title}" is in Shaping: its Initiative isn't confirmed.`];
  return [
    `"${task.title}" is in ${TASK_STATE_NAMES[task.state]}; it has started and is never rewritten: open a Decision on it saying what changed and what you recommend.`,
  ];
}

/**
 * The Planner rewrites a part of an already planned Task from the Initiative's latest planning
 * Thread `threadId` (spec §2.1), in one save with `write`, the part's own change: a Ready Task goes
 * back to Planning in this Thread, in one move `by` the person planning it; a Task in Planning from
 * an earlier planning Thread is planned in this one. Either is no longer marked planned, in the
 * Initiative's auto mode, so mark_planned accepts it again. Undefined when `write` changes nothing,
 * which moves nothing. Refused with the reasons of `rewritingProblems`, and from an earlier
 * planning Thread.
 */
export function rewriteInInitiative<Event extends DomainEvent>(
  initiative: Initiative,
  task: Task,
  threadId: string,
  by: Author,
  write: (task: Task) => TaskChange<Event> | undefined,
): TaskChange<TaskRewrittenInInitiative> | undefined {
  if (initiative.planningThreadId !== threadId) {
    throw new InitiativeRefused([
      "Only the Initiative's latest planning Thread rewrites its planned Tasks; this Thread is an earlier one.",
    ]);
  }
  const problems = rewritingProblems(task, { initiativeId: initiative.id, threadId });
  if (problems.length > 0) throw new TaskRefused(problems);
  const replanned: Task = {
    ...task,
    state: "planning",
    autoMode: initiative.planningAutoMode,
    initiativePlanningThreadId: threadId,
    markedPlanned: false,
    hasPlanningThread: true,
  };
  const written = write(replanned);
  if (!written) return undefined;
  if (task.state !== "ready") {
    return {
      task: written.task,
      event: new TaskRewrittenInInitiative(task.id, written.event, []),
    };
  }
  return withStateChange(
    {
      task: written.task,
      event: new TaskRewrittenInInitiative(task.id, written.event, [
        new TaskStateChanged(task.id, "ready", "planning"),
      ]),
    },
    task,
    by,
  );
}

/**
 * The Tasks inside its Initiative it waits for that are neither planned, Ready or beyond, nor
 * Dropped.
 */
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
  /** Its Project Pipelines, which only its Tasks can follow. */
  readonly ownPipelines: readonly PlanningPipeline[];
  /** The Pipeline it gives each Kind it has a default of its own for; its default otherwise. */
  readonly kindPipelines?: Readonly<Partial<Record<TaskKind, string>>>;
}

/**
 * A Decision waiting on the user in a Thread, by the Task it is on and its question; on no Task,
 * on the Initiative as a whole.
 */
export interface OpenTaskDecision {
  readonly taskId: string | undefined;
  readonly question: string;
}

/** What an Initiative's planning Brief is assembled from, with no model call. */
export interface InitiativePlanningRecord {
  readonly initiative: Initiative;
  /** The Decisions open in this planning Thread, by the Task each is on, or on none. */
  readonly waiting: readonly OpenTaskDecision[];
  /** Its record as every session reads it: outcome, Tasks, dependencies and Attachments. */
  readonly record: string;
  readonly tasks: readonly Task[];
  readonly projects: readonly InitiativePlanningProject[];
  /** The office-wide Pipelines; each Project's own are with it. */
  readonly pipelines: readonly PlanningPipeline[];
}

/**
 * An Initiative's planning Thread's Brief (spec §2.5): its record, who opened the Thread, the Backlog Tasks to plan with
 * their blockers inside it, the Tasks being planned and those waiting for an answer, the Projects
 * it spans with their base branches and commands, the Pipeline library and whether it is planned in
 * auto mode.
 */
export function initiativePlanningBrief(
  prompts: PromptTexts,
  { initiative, waiting, record, tasks, projects, pipelines }: InitiativePlanningRecord,
): string {
  const tasksToPlan = tasksToPlanValues(tasks, projects, pipelines);
  const beingPlanned = beingPlannedValues(initiative, tasks);
  const waitingOnTasks = waitingValues(waiting, tasks);
  return renderedText(prompts, INITIATIVE_PLANNING_BRIEF, {
    record,
    planningOpenedBy: initiativePlanningOpenedBy(initiative),
    withUser: initiative.planningWithUser,
    hasTasksToPlan: tasksToPlan.length > 0,
    tasksToPlan,
    hasBeingPlanned: beingPlanned.length > 0,
    beingPlanned,
    hasWaiting: waitingOnTasks.length > 0,
    waiting: waitingOnTasks,
    projects: projects.map((project, index) => ({
      first: flagField(index === 0),
      name: project.name,
      id: project.id,
      baseBranch: project.baseBranch,
      defaultPipeline: defaultPipelineWords(
        [...project.ownPipelines, ...pipelines],
        project.defaultPipeline,
      ),
      commands: commandLines(project).join("\n"),
    })),
    pipelineLibrary: pipelineGroups(
      projects.map((project) => ({ project, own: project.ownPipelines })),
      pipelines,
    ).join("\n\n"),
    autoMode: initiative.planningAutoMode,
  });
}

/** Its Tasks in Backlog, each with the Tasks inside the Initiative it waits for. */
function tasksToPlanValues(
  tasks: readonly Task[],
  projects: readonly InitiativePlanningProject[],
  officeWide: readonly PlanningPipeline[],
): {
  title: string;
  id: string;
  projectName: string;
  waitsFor: string;
  kind: string;
  kindPlural: string;
  commitType: string;
  bugDetails: string;
  defaultPipeline: string;
}[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const projectOf = (id: string) => projects.find((project) => project.id === id);
  const kindPipeline = (task: Task) => {
    const project = projectOf(task.projectId);
    if (!project) return "";
    return defaultPipelineWords(
      [...project.ownPipelines, ...officeWide],
      project.kindPipelines?.[task.kind] ?? project.defaultPipeline,
    );
  };
  return tasks
    .filter(({ state }) => state === "backlog")
    .map((task) => ({
      title: task.title,
      id: task.id,
      projectName: projectOf(task.projectId)?.name ?? task.projectId,
      ...kindValues(task),
      bugDetails: bugDetailsWords(task, task.causedBy ? byId.get(task.causedBy) : undefined),
      defaultPipeline: kindPipeline(task),
      waitsFor: task.blockedBy
        .map((id) => byId.get(id))
        .filter((blocker) => blocker !== undefined)
        .map(
          (blocker) =>
            `"${blocker.title}" (Task ${blocker.id}, ${TASK_STATE_NAMES[blocker.state]})`,
        )
        .join(", "),
    }));
}

/**
 * The Tasks this Thread moved to Planning and hasn't marked planned, for a fresh session to carry
 * on with: the earlier session's context, and with it how far it got, is gone.
 */
function beingPlannedValues(
  initiative: Initiative,
  tasks: readonly Task[],
): { title: string; id: string }[] {
  return tasks
    .filter(
      (task) =>
        isBeingPlannedInItsInitiative(task) &&
        task.initiativePlanningThreadId === initiative.planningThreadId,
    )
    .map(({ id, title }) => ({ title, id }));
}

/**
 * The Decisions on Tasks this Thread opened that wait on the user, for a fresh session: it leaves
 * their Tasks, and the Tasks waiting for them, until each answer comes as a message. The one on the
 * Initiative as a whole is left to Conversations' own section of every Initiative Thread's Brief.
 */
function waitingValues(
  waiting: readonly OpenTaskDecision[],
  tasks: readonly Task[],
): { taskTitle: string; taskId: string; question: string }[] {
  const titleOf = (id: string) => tasks.find((task) => task.id === id)?.title ?? id;
  return waiting.flatMap(({ taskId, question }) =>
    taskId === undefined ? [] : [{ taskTitle: titleOf(taskId), taskId, question }],
  );
}

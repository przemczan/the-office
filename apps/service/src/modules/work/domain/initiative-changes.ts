import type { DomainEvent } from "../../../platform/events/domain-event.js";
import {
  hasAnyPipeline,
  initiativeProjectIds,
  isPipelineFixed,
  pipelineIn,
  type Initiative,
  type InitiativePipeline,
  type InitiativeState,
} from "./initiative.js";
import { THE_USER, type Author } from "./author.js";
import {
  InitiativeBranchMade,
  InitiativeCreated,
  InitiativeOutcomeWritten,
  InitiativePipelineChosen,
  InitiativeShortNameWritten,
  InitiativeStateChanged,
} from "./initiative-events.js";
import { derivedShortName, initiativeBranchOf, shortNameProblems } from "./short-name.js";
import { InitiativeNotShaping } from "./initiative-not-shaping.js";
import { InitiativeRefused } from "./initiative-refused.js";
import { newTaskProblems, trimmedNewTask, type NewTask, type Task } from "./task.js";
import { titleProblem } from "./title.js";
import {
  changeTaskState,
  createTask,
  moveToBacklogOnConfirm,
  type NewTaskSetting,
  type TaskChange,
} from "./task-changes.js";
import { projectsToPublish, unfinishedPublishingTask } from "./publishing-task.js";
import { addDependency, blockPublishingTask, removeDependency } from "./task-dependencies.js";
import { changeDescription, changeTitle } from "./task-description.js";
import { TaskRefused } from "./task-refused.js";
import type { StateChangeCause } from "./state-change.js";
import type {
  TaskCreated,
  TaskDependencyAdded,
  TaskDependencyRemoved,
  TaskDescriptionChanged,
  TaskStateChanged,
  TaskTitleChanged,
} from "./task-events.js";

/** An Initiative after a change, with the event that announces it. */
export interface InitiativeChange<Event extends DomainEvent> {
  readonly initiative: Initiative;
  readonly event: Event;
}

/** An Initiative's change that changes its Tasks too, each by a change of its own. */
export interface InitiativeTasksChange<Event extends DomainEvent> extends InitiativeChange<Event> {
  readonly taskChanges: readonly TaskChange<DomainEvent>[];
}

/**
 * What one attempt at Confirm branched before the Initiative was held: the Initiative's branch,
 * named by `shortName`, made in each of `projectIds` (spec 5.5).
 */
export interface ConfirmBranching {
  readonly shortName: string;
  readonly projectIds: readonly string[];
  readonly madeAt: Date;
}

/** What create_initiative is given: the Initiative's name and its outcome, both required. */
export interface NewInitiative {
  readonly name: string;
  readonly outcome: string;
}

/**
 * An Initiative being shaped that comes from no Idea (create_initiative, spec 2.1): named and with
 * its outcome written, no Tasks yet, waiting for the user's Confirm as one shaped from an Idea does.
 */
export function createInitiative(
  setting: NewInitiative,
  initiativeId: string,
  createdBy: Author,
  at: Date,
): InitiativeChange<InitiativeCreated> {
  const name = setting.name.trim();
  const outcome = setting.outcome.trim();
  const nameProblem = titleProblem(name, "Initiative");
  const problems = [
    ...(nameProblem ? [nameProblem] : []),
    ...(outcome === "" ? ["Write what must be true once the Initiative is done."] : []),
  ];
  if (problems.length > 0) throw new InitiativeRefused(problems);
  const initiative: Initiative = {
    id: initiativeId,
    name,
    outcome,
    state: "shaping",
    originIdeaId: undefined,
    createdBy,
    createdAt: at,
    planningThreadIds: [],
    planningAutoMode: false,
    pipelines: [],
    branches: [],
  };
  return { initiative, event: new InitiativeCreated(initiative) };
}

/**
 * "Confirm the Initiative": its outcome and Task list are agreed, so it becomes active and its
 * Tasks in Shaping move to Backlog. Whether each Project its Tasks span (Tasks still in Shaping
 * too) has a Pipeline is fixed here: `branched` must hold its branch in exactly the Projects with
 * one, and is kept; with None in every Project it keeps no Short name.
 */
export function confirmInitiative(
  initiative: Initiative,
  tasks: readonly Task[],
  branched: ConfirmBranching | undefined,
): InitiativeTasksChange<InitiativeStateChanged> {
  if (initiative.state !== "shaping") {
    throw new InitiativeRefused([
      `Only an Initiative being shaped can be confirmed; this one is ${initiative.state}.`,
    ]);
  }
  const confirmed = moveTo(initiative, "active", undefined);
  return {
    ...confirmed,
    initiative: { ...confirmed.initiative, ...fixedPipelines(initiative, tasks, branched) },
    taskChanges: inShaping(tasks).map(moveToBacklogOnConfirm),
  };
}

const CONFIRM_AGAIN = "The Initiative changed while it was being confirmed; confirm it again.";

/** Every Project the Initiative spans with its Pipeline or None, as Confirm fixes them. */
function fixedPipelines(
  initiative: Initiative,
  tasks: readonly Task[],
  branched: ConfirmBranching | undefined,
): Pick<Initiative, "pipelines" | "shortName" | "branches"> {
  const pipelines = initiativeProjectIds(tasks).map((projectId) => ({
    projectId,
    pipelineId: pipelineIn(initiative, projectId),
  }));
  const withPipeline = projectsWithPipeline(pipelines);
  if (withPipeline.length === 0) {
    if (branched !== undefined) throw new InitiativeRefused([CONFIRM_AGAIN]);
    return { pipelines, shortName: undefined, branches: initiative.branches };
  }
  if (
    branched === undefined ||
    branched.shortName !== initiative.shortName ||
    !sameProjects(withPipeline, branched.projectIds)
  ) {
    throw new InitiativeRefused([CONFIRM_AGAIN]);
  }
  return {
    pipelines,
    shortName: initiative.shortName,
    branches: branched.projectIds.map((projectId) => ({ projectId, madeAt: branched.madeAt })),
  };
}

/** The Projects of `pipelines` that have a Pipeline, in their order. */
export function projectsWithPipeline(pipelines: readonly InitiativePipeline[]): string[] {
  return pipelines.flatMap(({ projectId, pipelineId }) =>
    pipelineId === undefined ? [] : [projectId],
  );
}

function sameProjects(first: readonly string[], second: readonly string[]): boolean {
  return first.length === second.length && first.every((projectId) => second.includes(projectId));
}

/**
 * The Initiative's Pipeline in one Project (spec 2.1), undefined for None: chosen straight while
 * shaping, by a Proposal of whoever shapes Initiatives once active. Confirm fixed whether each Project it spanned then
 * has one, so a Proposal only swaps one Pipeline for another there; a Project it came to span
 * since has None until a Proposal gives it one. The first Pipeline chosen in any Project derives
 * the Short name from the title, past those `taken`; None everywhere leaves it none. Undefined when
 * the Project follows that Pipeline already.
 */
export function chooseInitiativePipeline(
  initiative: Initiative,
  project: { readonly id: string; readonly name: string },
  pipelineId: string | undefined,
  route: InitiativeChangeRoute,
  taken: ReadonlySet<string>,
): InitiativeChange<InitiativePipelineChosen> | undefined {
  const projectId = project.id;
  const current = pipelineIn(initiative, projectId);
  if (initiative.state !== "shaping") {
    const fixedNone = current === undefined && isPipelineFixed(initiative, projectId);
    if (pipelineId === undefined || fixedNone) {
      throw new InitiativeRefused([pipelineFixedAtConfirmWords(project.name)]);
    }
  }
  if (pipelineId === current) return undefined;
  requireOpenTo(initiative, route, "its Pipelines are chosen straight onto it");
  const others = initiative.pipelines.filter((entry) => entry.projectId !== projectId);
  // While shaping, None is no entry, so only the Projects given a Pipeline are kept.
  const pipelines =
    pipelineId === undefined && initiative.state === "shaping"
      ? others
      : [...others, { projectId, pipelineId }];
  const shortName = hasAnyPipeline({ ...initiative, pipelines })
    ? (initiative.shortName ?? derivedShortName(initiative.name, initiative.id, taken))
    : undefined;
  return {
    initiative: { ...initiative, pipelines, shortName },
    event: new InitiativePipelineChosen(initiative.id, projectId, pipelineId, shortName),
  };
}

function pipelineFixedAtConfirmWords(projectName: string): string {
  return `Whether the Initiative has a Pipeline in ${projectName} was fixed at Confirm.`;
}

/**
 * The user's own Short name, while shaping and with a Pipeline chosen (spec 5.5); refused when
 * it isn't of the form or another Initiative holds it. Undefined when it is the name already.
 */
export function writeShortName(
  initiative: Initiative,
  shortName: string,
  taken: ReadonlySet<string>,
): InitiativeChange<InitiativeShortNameWritten> | undefined {
  const written = shortName.trim();
  if (!hasAnyPipeline(initiative)) {
    throw new InitiativeRefused([
      "Choose a Pipeline first: an Initiative on None in every Project has no branch to name.",
    ]);
  }
  if (written === initiative.shortName) return undefined;
  const problems = shortNameProblems(written, taken);
  if (problems.length > 0) throw new InitiativeRefused(problems);
  requireOpenTo(initiative, "straight", "its Short name is written");
  return {
    initiative: { ...initiative, shortName: written },
    event: new InitiativeShortNameWritten(initiative.id, written),
  };
}

/**
 * The Initiative's branch made, once it is active, in a Project with a Pipeline its Tasks come to
 * span again, or that a Proposal gave a Pipeline; undefined when the record has it there already.
 */
export function addBranch(
  initiative: Initiative,
  projectId: string,
  at: Date,
): InitiativeChange<InitiativeBranchMade> | undefined {
  const { shortName } = initiative;
  if (pipelineIn(initiative, projectId) === undefined || shortName === undefined) {
    throw new InitiativeRefused([`The Initiative has None in ${projectId}, so no branch to make.`]);
  }
  if (initiative.branches.some((branch) => branch.projectId === projectId)) return undefined;
  return {
    initiative: { ...initiative, branches: [...initiative.branches, { projectId, madeAt: at }] },
    event: new InitiativeBranchMade(initiative.id, projectId, initiativeBranchOf(shortName)),
  };
}

/**
 * Undefined when it is already dropped. Every one of its Tasks not yet Done or Dropped drops with
 * it, started ones and those its Pause held too, each as by the user's own Drop (spec 2.1, "An
 * Initiative is done"); a paused one is no longer paused.
 */
export function dropInitiative(
  initiative: Initiative,
  tasks: readonly Task[],
  at: Date,
): InitiativeTasksChange<InitiativeStateChanged> | undefined {
  if (initiative.state === "dropped") return undefined;
  if (initiative.state === "done") {
    throw new InitiativeRefused(["A done Initiative can't be dropped."]);
  }
  return { ...moveTo(initiative, "dropped", at), taskChanges: dropOpen(tasks, THE_USER) };
}

/**
 * The Tasks a Dropped Initiative left open, from before a Drop took them along (spec 2.1), dropped
 * `by` The Office; none for any other Initiative, or once none is open, so it can run again.
 */
export function dropLeftOpenTasks(
  initiative: Initiative,
  tasks: readonly Task[],
  by: StateChangeCause,
): readonly TaskChange<TaskStateChanged>[] {
  return initiative.state === "dropped" ? dropOpen(tasks, by) : [];
}

function dropOpen(
  tasks: readonly Task[],
  by: StateChangeCause,
): readonly TaskChange<TaskStateChanged>[] {
  return tasks
    .filter(({ state }) => state !== "done" && state !== "dropped")
    .flatMap((task) => changeTaskState(task, "dropped", by) ?? []);
}

function inShaping(tasks: readonly Task[]): readonly Task[] {
  return tasks.filter(({ state }) => state === "shaping");
}

/**
 * Done once it is active and every one of its Tasks that isn't Dropped is Done, at least one of
 * them (spec §2.1 Defaults); undefined otherwise, a shaping one waiting for Confirm.
 */
export function finishInitiative(
  initiative: Initiative,
  tasks: readonly Pick<Task, "state">[],
  at: Date,
): InitiativeChange<InitiativeStateChanged> | undefined {
  if (initiative.state !== "active") return undefined;
  const kept = tasks.filter(({ state }) => state !== "dropped");
  if (kept.length === 0 || kept.some(({ state }) => state !== "done")) return undefined;
  return moveTo(initiative, "done", at);
}

/** What the Initiative's done check came to: the Publishing Tasks it added, and its move to done. */
export interface InitiativeSettling {
  readonly initiative: Initiative;
  readonly event: InitiativeStateChanged | undefined;
  readonly created: readonly TaskChange<TaskCreated>[];
}

/**
 * The Initiative's done check (spec 2.1): first the Publishing Tasks for the Projects whose branch
 * holds `unpublished` work, made by `publishingTaskIn`, then finishInitiative over every Task, the
 * new ones too, so an Initiative with a Pipeline is done only once its Publishing Tasks are.
 */
export function settleInitiative(
  initiative: Initiative,
  tasks: readonly Task[],
  unpublished: ReadonlySet<string>,
  publishingTaskIn: (projectId: string) => TaskChange<TaskCreated>,
  at: Date,
): InitiativeSettling {
  const created = projectsToPublish(initiative, tasks, unpublished).map(publishingTaskIn);
  const finished = finishInitiative(initiative, [...tasks, ...created.map(({ task }) => task)], at);
  return { initiative: finished?.initiative ?? initiative, event: finished?.event, created };
}

/** A Task added to an Initiative, with the Publishing Task it now blocks, if any. */
export interface InitiativeTaskAdded {
  readonly created: TaskChange<TaskCreated>;
  readonly blocking: TaskChange<TaskDependencyAdded> | undefined;
}

/**
 * The new Task, with its Project's unfinished Publishing Task made to wait for it (spec 2.1,
 * "Publishing Tasks"); `tasks` are the Initiative's.
 */
export function blockingItsPublishingTask(
  created: TaskChange<TaskCreated>,
  tasks: readonly Task[],
): InitiativeTaskAdded {
  const publishing = unfinishedPublishingTask(
    tasks.filter(({ initiativeId }) => initiativeId === created.task.initiativeId),
    created.task.projectId,
  );
  return {
    created,
    blocking: publishing && blockPublishingTask(publishing, created.task.id, tasks),
  };
}

/**
 * A new Task in the Initiative: in Shaping until the Initiative is confirmed, in Backlog from then
 * on; a done or dropped one takes no more.
 */
export function addTaskToInitiative(
  initiative: Initiative,
  id: string,
  given: NewTask,
  setting: Omit<NewTaskSetting, "initiativeId" | "originIdeaId">,
  at: Date,
): TaskChange<TaskCreated> {
  if (initiative.state === "done" || initiative.state === "dropped") {
    throw new InitiativeRefused([`A ${initiative.state} Initiative takes no more Tasks.`]);
  }
  return createTask(
    id,
    given,
    { ...setting, originIdeaId: undefined, initiativeId: initiative.id },
    at,
    initiative.state === "shaping" ? "shaping" : "backlog",
  );
}

/**
 * How a change reaches an Initiative (spec §2.1 Defaults): straight onto it, only while it is being
 * shaped, or by a Proposal of whoever shapes Initiatives, which the user applies, while it is shaping or active.
 */
export type InitiativeChangeRoute = "straight" | "by-proposal";

/**
 * What must be true once it is done, written by whoever shapes Initiatives or the user; undefined when it says so
 * already. Each change below judges what it asks before the Initiative's state, so a request that
 * is wrong or changes nothing is answered as such, never turned into a Proposal.
 */
export function writeOutcome(
  initiative: Initiative,
  outcome: string,
  route: InitiativeChangeRoute,
): InitiativeChange<InitiativeOutcomeWritten> | undefined {
  const written = outcome.trim();
  if (written === "") {
    throw new InitiativeRefused(["Write what must be true once the Initiative is done."]);
  }
  if (written === initiative.outcome) return undefined;
  requireOpenTo(initiative, route, "its outcome is written");
  return {
    initiative: { ...initiative, outcome: written },
    event: new InitiativeOutcomeWritten(initiative.id, written),
  };
}

/** A new Task by whoever shapes Initiatives in the Initiative; the user adds one with addTaskToInitiative. */
export function addCtoTask(
  initiative: Initiative,
  route: InitiativeChangeRoute,
  id: string,
  given: NewTask,
  setting: Omit<NewTaskSetting, "initiativeId" | "originIdeaId">,
  at: Date,
): TaskChange<TaskCreated> {
  requireCtoTaskAllowed(initiative, route, given);
  return addTaskToInitiative(initiative, id, given, setting, at);
}

/**
 * Refuses a new Task by whoever shapes Initiatives as addCtoTask would, without making it, together with
 * `blockerProblems`, the reasons it couldn't wait for the Tasks it asks to.
 */
export function requireCtoTaskAllowed(
  initiative: Initiative,
  route: InitiativeChangeRoute,
  given: NewTask,
  blockerProblems: readonly string[] = [],
): void {
  const problems = [...newTaskProblems(trimmedNewTask(given)), ...blockerProblems];
  if (problems.length > 0) throw new TaskRefused(problems);
  requireOpenTo(initiative, route, SHAPING_CHANGES);
}

/**
 * Whoever shapes Initiatives makes one of the Initiative's Tasks wait for `blockerId`, any Task anywhere; the rules
 * are addDependency's.
 */
export function addDependencyOfItsTask(
  initiative: Initiative,
  route: InitiativeChangeRoute,
  task: Task,
  blockerId: string,
  tasks: readonly Task[],
): TaskChange<TaskDependencyAdded> | undefined {
  return changeItsTask(initiative, route, task, () => addDependency(task, blockerId, tasks));
}

export function removeDependencyOfItsTask(
  initiative: Initiative,
  route: InitiativeChangeRoute,
  task: Task,
  blockerId: string,
): TaskChange<TaskDependencyRemoved> | undefined {
  return changeItsTask(initiative, route, task, () => removeDependency(task, blockerId));
}

/** Whoever shapes Initiatives rewrites the title of one of the Initiative's Tasks; the rules are changeTitle's. */
export function changeTitleOfItsTask(
  initiative: Initiative,
  route: InitiativeChangeRoute,
  task: Task,
  title: string,
): TaskChange<TaskTitleChanged> | undefined {
  return changeItsTask(initiative, route, task, () => changeTitle(task, title));
}

/** Whoever shapes Initiatives rewrites the Description of one of its Tasks; the rules are changeDescription's. */
export function changeDescriptionOfItsTask(
  initiative: Initiative,
  route: InitiativeChangeRoute,
  task: Task,
  description: string,
): TaskChange<TaskDescriptionChanged> | undefined {
  return changeItsTask(initiative, route, task, () => changeDescription(task, description));
}

function changeItsTask<Event extends DomainEvent>(
  initiative: Initiative,
  route: InitiativeChangeRoute,
  task: Task,
  change: () => TaskChange<Event> | undefined,
): TaskChange<Event> | undefined {
  requireItsTask(initiative, task);
  const changed = change();
  if (changed) requireOpenTo(initiative, route, SHAPING_CHANGES);
  return changed;
}

const SHAPING_CHANGES = "its Tasks and their dependencies change straight onto it";

function requireOpenTo(initiative: Initiative, route: InitiativeChangeRoute, change: string): void {
  const { state } = initiative;
  if (route === "straight" && state !== "shaping") throw new InitiativeNotShaping(state, change);
  if (state === "done" || state === "dropped") {
    throw new InitiativeRefused([`The Initiative is ${state}: it changes no more.`]);
  }
}

function requireItsTask(initiative: Initiative, task: Task): void {
  if (task.initiativeId !== initiative.id) {
    throw new InitiativeRefused([`The Task "${task.title}" isn't one of this Initiative's.`]);
  }
}

/**
 * Every Initiative's Tasks on the board, by the Initiative's id, in the order they were added, so
 * the Projects one spans keep their order.
 */
export function tasksByInitiative(board: readonly Task[]): ReadonlyMap<string, readonly Task[]> {
  const byInitiative = new Map<string, Task[]>();
  const added = board.toSorted(
    (one, other) =>
      one.createdAt.getTime() - other.createdAt.getTime() || one.id.localeCompare(other.id),
  );
  for (const task of added) {
    if (!task.initiativeId) continue;
    const tasks = byInitiative.get(task.initiativeId) ?? [];
    tasks.push(task);
    byInitiative.set(task.initiativeId, tasks);
  }
  return byInitiative;
}

/** `endedAt` is the moment of a move to Done or Dropped, from which its Archive period counts. */
/** The Pause's mark lives only beside the active state, so a move out of it clears the mark. */
function moveTo(
  initiative: Initiative,
  to: InitiativeState,
  endedAt: Date | undefined,
): InitiativeChange<InitiativeStateChanged> {
  const pausedAt = to === "active" ? initiative.pausedAt : undefined;
  return {
    initiative: { ...initiative, state: to, endedAt, pausedAt },
    event: new InitiativeStateChanged(initiative.id, initiative.state, to),
  };
}

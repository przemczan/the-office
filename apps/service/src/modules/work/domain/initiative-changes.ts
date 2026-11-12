import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { initiativeProjectIds, type Initiative, type InitiativeState } from "./initiative.js";
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

/** An Initiative's change that moves its Tasks too, each by a change of its own. */
export interface InitiativeTasksChange<Event extends DomainEvent> extends InitiativeChange<Event> {
  readonly taskChanges: readonly TaskChange<TaskStateChanged>[];
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
    planningAutoMode: false,
    branches: [],
  };
  return { initiative, event: new InitiativeCreated(initiative) };
}

/**
 * "Confirm the Initiative": its outcome and Task list are agreed, so it becomes active and its
 * Tasks in Shaping move to Backlog. Whether it has a Pipeline is fixed here: with one, `branched`
 * must hold its branch in every Project its Tasks span, Tasks still in Shaping too, and is kept;
 * on None it keeps no Short name.
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
    initiative: { ...confirmed.initiative, ...fixedPipeline(initiative, tasks, branched) },
    taskChanges: inShaping(tasks).map(moveToBacklogOnConfirm),
  };
}

const CONFIRM_AGAIN = "The Initiative changed while it was being confirmed; confirm it again.";

function fixedPipeline(
  initiative: Initiative,
  tasks: readonly Task[],
  branched: ConfirmBranching | undefined,
): Pick<Initiative, "shortName" | "branches"> {
  if (initiative.pipelineId === undefined) {
    if (branched !== undefined) throw new InitiativeRefused([CONFIRM_AGAIN]);
    return { shortName: undefined, branches: initiative.branches };
  }
  if (branched === undefined || branched.shortName !== initiative.shortName) {
    throw new InitiativeRefused([CONFIRM_AGAIN]);
  }
  const unbranched = initiativeProjectIds(tasks).filter(
    (projectId) => !branched.projectIds.includes(projectId),
  );
  if (unbranched.length > 0) throw new InitiativeRefused([CONFIRM_AGAIN]);
  return {
    shortName: initiative.shortName,
    branches: branched.projectIds.map((projectId) => ({ projectId, madeAt: branched.madeAt })),
  };
}

/**
 * The Initiative's Pipeline (spec 2.1), undefined for None: chosen straight while shaping, by the
 * CTO's Proposal once active, where whether it has one stays as Confirm fixed it. The first
 * Pipeline chosen derives its Short name from the title, past those `taken`; None leaves it none.
 * Undefined when it follows that Pipeline already.
 */
export function chooseInitiativePipeline(
  initiative: Initiative,
  pipelineId: string | undefined,
  route: InitiativeChangeRoute,
  taken: ReadonlySet<string>,
): InitiativeChange<InitiativePipelineChosen> | undefined {
  if (initiative.state !== "shaping") {
    if (pipelineId === undefined || initiative.pipelineId === undefined) {
      throw new InitiativeRefused([PIPELINE_FIXED_AT_CONFIRM]);
    }
  }
  if (pipelineId === initiative.pipelineId) return undefined;
  requireOpenTo(initiative, route, "its Pipeline is chosen straight onto it");
  const shortName =
    pipelineId === undefined
      ? undefined
      : (initiative.shortName ?? derivedShortName(initiative.name, initiative.id, taken));
  return {
    initiative: { ...initiative, pipelineId, shortName },
    event: new InitiativePipelineChosen(initiative.id, pipelineId, shortName),
  };
}

const PIPELINE_FIXED_AT_CONFIRM = "Whether the Initiative has a Pipeline was fixed at Confirm.";

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
  if (initiative.pipelineId === undefined) {
    throw new InitiativeRefused([
      "Choose a Pipeline first: an Initiative on None has no branch to name.",
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
 * The Initiative's branch made in a Project its Tasks come to span once it is active; undefined
 * when the record has it there already.
 */
export function addBranch(
  initiative: Initiative,
  projectId: string,
  at: Date,
): InitiativeChange<InitiativeBranchMade> | undefined {
  const { shortName } = initiative;
  if (initiative.pipelineId === undefined || shortName === undefined) {
    throw new InitiativeRefused(["An Initiative on None has no branch to make."]);
  }
  if (initiative.branches.some((branch) => branch.projectId === projectId)) return undefined;
  return {
    initiative: { ...initiative, branches: [...initiative.branches, { projectId, madeAt: at }] },
    event: new InitiativeBranchMade(initiative.id, projectId, initiativeBranchOf(shortName)),
  };
}

/**
 * Undefined when it is already dropped. Its Tasks still in Shaping could never move on, so they
 * drop with it; every other Task stays as it is.
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
  return {
    ...moveTo(initiative, "dropped", at),
    taskChanges: inShaping(tasks).flatMap(
      (task) => changeTaskState(task, "dropped", THE_USER) ?? [],
    ),
  };
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
 * shaped, or by a Proposal of the CTO's the user applies, while it is shaping or active.
 */
export type InitiativeChangeRoute = "straight" | "by-proposal";

/**
 * What must be true once it is done, written by the CTO or the user; undefined when it says so
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

/** The CTO's new Task in the Initiative; the user adds one with addTaskToInitiative. */
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
 * Refuses the CTO's new Task as addCtoTask would, without making it, together with
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
  requireOpenTo(initiative, route, CTO_CHANGES);
}

/**
 * The CTO makes one of the Initiative's Tasks wait for `blockerId`, any Task anywhere; the rules
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

/** The CTO rewrites the title of one of the Initiative's Tasks; the rules are changeTitle's. */
export function changeTitleOfItsTask(
  initiative: Initiative,
  route: InitiativeChangeRoute,
  task: Task,
  title: string,
): TaskChange<TaskTitleChanged> | undefined {
  return changeItsTask(initiative, route, task, () => changeTitle(task, title));
}

/** The CTO rewrites the Description of one of its Tasks; the rules are changeDescription's. */
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
  if (changed) requireOpenTo(initiative, route, CTO_CHANGES);
  return changed;
}

const CTO_CHANGES = "its Tasks and their dependencies change straight onto it";

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
function moveTo(
  initiative: Initiative,
  to: InitiativeState,
  endedAt: Date | undefined,
): InitiativeChange<InitiativeStateChanged> {
  return {
    initiative: { ...initiative, state: to, endedAt },
    event: new InitiativeStateChanged(initiative.id, initiative.state, to),
  };
}

import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { THE_USER, type Author } from "./author.js";
import { normalizedFilesToChange } from "./files-to-change.js";
import type { ProposedPipeline, Task } from "./task.js";
import type { AutoModeConfirmation, StateChangeCause } from "./state-change.js";
import { markTaskReady, withStateChange, type TaskChange } from "./task-changes.js";
import {
  TaskAcceptedInAutoMode,
  TaskDefinitionOfDoneConfirmed,
  TaskDefinitionOfDoneProposed,
  TaskDefinitionOfDoneSaved,
  TaskMarkedPlanned,
  TaskPipelineConfirmed,
  TaskPipelineProposed,
  TaskPlanConfirmed,
  TaskPlanProposed,
  TaskPlanSaved,
  TaskStateChanged,
} from "./task-events.js";
import { TaskRefused } from "./task-refused.js";
import { CONFIRM_ITS_INITIATIVE, NOT_STARTED_STATES, TASK_STATE_NAMES } from "./task-states.js";
import {
  definitionOfDoneProblems,
  planProblems,
  trimmedStatements,
  writtenPlanProblems,
  type PlanWriting,
  type WrittenPlan,
} from "./written-parts.js";

/*
 * The Planner proposes the Plan, the Definition of Done and a Pipeline on a Task in Planning or
 * Ready; the user saves their own words until the Task starts, and confirms each part as it reads
 * (spec §2.1, §2.3). Writing a part again, by either, leaves it unconfirmed; the same words change
 * nothing. The Plan's files to change go with it: written, saved and confirmed together. The
 * Planner writing a part of a Task marked planned takes the mark back: they mark it planned again
 * once it is done. A change to a Ready Task takes it back to be planned and marked Ready again
 * (the user's words of 2026-11-11).
 */

export function proposePlan(
  task: Task,
  writing: PlanWriting,
  by: Author,
): TaskChange<TaskPlanProposed> | undefined {
  const written = writtenPlan(task, writing);
  refuseWith([...proposingProblems(task, "The Plan"), ...writtenPlanProblems(written)]);
  if (samePlan(task, written)) return undefined;
  return proposedPart(
    task,
    { ...task, ...written, planConfirmed: false },
    (leftReady) => new TaskPlanProposed(task.id, leftReady),
    by,
  );
}

/**
 * The user's Plan. Changing it leaves it unconfirmed, and a Ready Task goes back to Planning, or
 * to Backlog when it has no planning Thread.
 */
export function savePlan(task: Task, writing: PlanWriting): TaskChange<TaskPlanSaved> | undefined {
  const written = writtenPlan(task, writing);
  refuseWith([...changingProblems(task, "Plan"), ...writtenPlanProblems(written)]);
  if (samePlan(task, written)) return undefined;
  return savedPart(
    task,
    { ...task, ...written, planConfirmed: false },
    (leftReady) => new TaskPlanSaved(task.id, leftReady),
  );
}

/** Confirm takes the Plan as it reads. */
export function confirmPlan(task: Task): TaskChange<TaskPlanConfirmed> | undefined {
  refuseWith([...changingProblems(task, "Plan"), ...planProblems(task.plan)]);
  if (task.planConfirmed) return undefined;
  return { task: { ...task, planConfirmed: true }, event: new TaskPlanConfirmed(task.id) };
}

function writtenPlan(
  task: Task,
  { plan, filesToChange, estimatedTokens }: PlanWriting,
): WrittenPlan {
  return {
    plan: plan.trim(),
    filesToChange: filesToChange ? normalizedFilesToChange(filesToChange) : task.filesToChange,
    estimatedTokens: estimatedTokens ?? task.estimatedTokens,
  };
}

function samePlan(task: Task, written: WrittenPlan): boolean {
  return (
    written.plan === task.plan &&
    sameStatements(written.filesToChange, task.filesToChange) &&
    written.estimatedTokens === task.estimatedTokens
  );
}

export function proposeDefinitionOfDone(
  task: Task,
  statements: readonly string[],
  by: Author,
): TaskChange<TaskDefinitionOfDoneProposed> | undefined {
  const trimmed = trimmedStatements(statements);
  refuseWith([
    ...proposingProblems(task, "The Definition of Done"),
    ...definitionOfDoneProblems(trimmed),
  ]);
  if (sameStatements(trimmed, task.definitionOfDone)) return undefined;
  return proposedPart(
    task,
    { ...task, definitionOfDone: trimmed, definitionOfDoneConfirmed: false },
    (leftReady) => new TaskDefinitionOfDoneProposed(task.id, leftReady),
    by,
  );
}

/** The user's Definition of Done, under the Plan's rules. */
export function saveDefinitionOfDone(
  task: Task,
  statements: readonly string[],
): TaskChange<TaskDefinitionOfDoneSaved> | undefined {
  const trimmed = trimmedStatements(statements);
  refuseWith([
    ...changingProblems(task, "Definition of Done"),
    ...definitionOfDoneProblems(trimmed),
  ]);
  if (sameStatements(trimmed, task.definitionOfDone)) return undefined;
  return savedPart(
    task,
    { ...task, definitionOfDone: trimmed, definitionOfDoneConfirmed: false },
    (leftReady) => new TaskDefinitionOfDoneSaved(task.id, leftReady),
  );
}

/** Confirm takes the Definition of Done as it reads. */
export function confirmDefinitionOfDone(
  task: Task,
): TaskChange<TaskDefinitionOfDoneConfirmed> | undefined {
  refuseWith([
    ...changingProblems(task, "Definition of Done"),
    ...definitionOfDoneProblems(task.definitionOfDone),
  ]);
  if (task.definitionOfDoneConfirmed) return undefined;
  return {
    task: { ...task, definitionOfDoneConfirmed: true },
    event: new TaskDefinitionOfDoneConfirmed(task.id),
  };
}

/**
 * The user's change to a part, unconfirmed by now. Ready needs both parts confirmed, so a Ready
 * Task leaves Ready in the same save, nothing can start it in between: back to Planning, in its
 * planning Thread and auto mode, to be marked Ready again; or, with no planning Thread to go back
 * to (marked Ready from Backlog), to Backlog, as a Task is never in Planning without its Thread.
 * Moved here rather than by `changeTaskState`, as nobody may ask for this move on its own.
 */
function savedPart<Event extends DomainEvent>(
  task: Task,
  saved: Task,
  announced: (leftReady: TaskStateChanged | undefined) => Event,
): TaskChange<Event> {
  if (task.state !== "ready") return { task: saved, event: announced(undefined) };
  return outOfReady(
    task,
    saved,
    task.hasPlanningThread ? "planning" : "backlog",
    THE_USER,
    announced,
  );
}

/**
 * The Planner's change to a part, unconfirmed by now and no longer marked planned. A Ready Task
 * goes back to Planning in the same save, moved `by` the person planning it, as the user's Save
 * takes it. The Planner writes here in the Task's own planning Thread (an Initiative's rewrites go
 * through `rewriteInInitiative`), so from then on the Task is planned in that Thread.
 */
function proposedPart<Event extends DomainEvent>(
  task: Task,
  proposed: Task,
  announced: (leftReady: TaskStateChanged | undefined) => Event,
  by: Author,
): TaskChange<Event> {
  const unmarked: Task = { ...proposed, markedPlanned: false };
  if (task.state !== "ready") return { task: unmarked, event: announced(undefined) };
  const inOwnThread: Task = {
    ...unmarked,
    initiativePlanningThreadId: undefined,
    hasPlanningThread: true,
  };
  return outOfReady(task, inOwnThread, "planning", by, announced);
}

function outOfReady<Event extends DomainEvent>(
  task: Task,
  changed: Task,
  to: Extract<Task["state"], "planning" | "backlog">,
  by: StateChangeCause,
  announced: (leftReady: TaskStateChanged | undefined) => Event,
): TaskChange<Event> {
  return withStateChange(
    {
      task: { ...changed, state: to, markedPlanned: false },
      event: announced(new TaskStateChanged(task.id, "ready", to)),
    },
    task,
    by,
  );
}

/** That the Pipeline is in the library is checked by the caller. */
export function proposePipeline(
  task: Task,
  proposal: ProposedPipeline,
  by: Author,
): TaskChange<TaskPipelineProposed> | undefined {
  const reason = proposal.reason.trim();
  const problems = proposingProblems(task, "A Pipeline");
  if (reason === "") problems.push("Say why the Pipeline fits the Definition of Done.");
  refuseWith(problems);
  const current = task.proposedPipeline;
  if (current?.pipelineId === proposal.pipelineId && current.reason === reason) return undefined;
  return proposedPart(
    task,
    { ...task, proposedPipeline: { pipelineId: proposal.pipelineId, reason } },
    (leftReady) => new TaskPipelineProposed(task.id, proposal.pipelineId, leftReady),
    by,
  );
}

/**
 * The user's Pipeline: the proposed one confirmed, or another they chose. It ends the proposal;
 * that the Pipeline is in the library is checked by the caller.
 */
export function confirmPipeline(
  task: Task,
  pipelineId: string,
): TaskChange<TaskPipelineConfirmed> | undefined {
  refuseWith(changingProblems(task, "Pipeline"));
  if (task.pipelineId === pipelineId && task.proposedPipeline === undefined) return undefined;
  return {
    task: { ...task, pipelineId, proposedPipeline: undefined },
    event: new TaskPipelineConfirmed(task.id, pipelineId),
  };
}

/**
 * Why the Planner can't mark the Task planned (mark_planned): only in Planning, once the Plan and
 * the Definition of Done are written and the Task has a Pipeline or a proposed one.
 */
export function markingPlannedProblems(task: Task): string[] {
  if (task.state !== "planning") {
    return [
      `A Task is marked planned while it is in Planning; this one is in ${TASK_STATE_NAMES[task.state]}.`,
    ];
  }
  return [
    ...(task.plan === "" ? ["Write the Plan first, with write_plan."] : []),
    ...(task.definitionOfDone.length === 0
      ? ["Write the Definition of Done first, with write_definition_of_done."]
      : []),
    ...(task.pipelineId === undefined && task.proposedPipeline === undefined
      ? ["The Task has no Pipeline yet: propose a Pipeline with propose_pipeline first."]
      : []),
  ];
}

/**
 * The Planner marks the Task planned (mark_planned), with auto mode off: it waits in Planning for
 * the user to confirm its parts. Undefined when it is marked planned already.
 */
export function markPlanned(task: Task): TaskChange<TaskMarkedPlanned> | undefined {
  refuseWith(markingPlannedProblems(task));
  if (task.markedPlanned) return undefined;
  return { task: { ...task, markedPlanned: true }, event: new TaskMarkedPlanned(task.id) };
}

/**
 * Auto mode accepts a Task marked planned, in one save: it marks it planned, confirms the Plan and
 * the Definition of Done if they aren't yet, and the proposed Pipeline if there is one (with none,
 * the Task keeps the Pipeline it follows, as only a Task that has one can be marked planned without
 * a proposal; that a proposal is in the library is checked by the caller), then marks it Ready
 * under Ready's usual rules. Its state change names only what auto
 * mode itself confirmed.
 */
export function acceptInAutoMode(
  task: Task,
  openDecisions: number,
): TaskChange<TaskAcceptedInAutoMode> {
  const problems = markingPlannedProblems(task);
  if (problems.length === 0 && !task.autoMode) {
    problems.push("This Task isn't planned in auto mode: the user confirms it and marks it Ready.");
  }
  refuseWith(problems);
  const confirmations: TaskAcceptedInAutoMode["confirmations"][number][] = [];
  const confirmed: AutoModeConfirmation[] = [];
  let accepted: Task = { ...task, markedPlanned: true };
  const plan = confirmPlan(accepted);
  if (plan) {
    accepted = plan.task;
    confirmations.push(plan.event);
    confirmed.push({ part: "plan" });
  }
  const definitionOfDone = confirmDefinitionOfDone(accepted);
  if (definitionOfDone) {
    accepted = definitionOfDone.task;
    confirmations.push(definitionOfDone.event);
    confirmed.push({ part: "definition-of-done" });
  }
  const proposal = accepted.proposedPipeline;
  const pipeline = proposal ? confirmPipeline(accepted, proposal.pipelineId) : undefined;
  if (pipeline) {
    accepted = pipeline.task;
    confirmations.push(pipeline.event);
    confirmed.push({ part: "pipeline", pipelineId: pipeline.event.pipelineId });
  }
  const ready = markTaskReady(accepted, openDecisions, { kind: "auto-mode", confirmed });
  // Undefined only for a Task Ready already, which the Planning check above refused.
  if (!ready) throw new TaskRefused(["The Task is Ready already."]);
  return {
    ...ready,
    event: new TaskAcceptedInAutoMode(task.id, confirmations, ready.event),
  };
}

/** The Planner writes a part in Planning, or in Ready, which the write takes back to Planning. */
function proposingProblems(task: Task, part: string): string[] {
  if (task.state === "planning" || task.state === "ready") return [];
  return [
    `${part} is proposed while the Task is in Planning or Ready, before it starts; this one is in ${TASK_STATE_NAMES[task.state]}.`,
  ];
}

function changingProblems(task: Task, part: string): string[] {
  if (task.state === "shaping") {
    return [`A Task in Shaping keeps its ${part} as it is: ${CONFIRM_ITS_INITIATIVE}`];
  }
  if (NOT_STARTED_STATES.includes(task.state)) return [];
  return [`A Task keeps its ${part} once it has started.`];
}

function sameStatements(given: readonly string[], kept: readonly string[]): boolean {
  return given.length === kept.length && given.every((statement, at) => statement === kept[at]);
}

function refuseWith(problems: readonly string[]): void {
  if (problems.length > 0) throw new TaskRefused(problems);
}

import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { THE_USER } from "./author.js";
import { normalizedFilesToChange } from "./files-to-change.js";
import type { ProposedPipeline, Task } from "./task.js";
import type { AutoModeConfirmation } from "./state-change.js";
import { markTaskReady, withStateChange, type TaskChange } from "./task-changes.js";
import {
  TaskAcceptedInAutoMode,
  TaskDefinitionOfDoneConfirmed,
  TaskDefinitionOfDoneProposed,
  TaskDefinitionOfDoneSaved,
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
 * The Planner proposes the Plan, the Definition of Done and a Pipeline on a Task in Planning; the
 * user saves their own words until the Task starts, and confirms each part as it reads (spec §2.1,
 * §2.3). Writing a part again, by either, leaves it unconfirmed; the same words change nothing. The
 * Plan's files to change go with it: written, saved and confirmed together.
 */

export function proposePlan(
  task: Task,
  writing: PlanWriting,
): TaskChange<TaskPlanProposed> | undefined {
  const written = writtenPlan(task, writing);
  refuseWith([...proposingProblems(task, "The Plan"), ...writtenPlanProblems(written)]);
  if (samePlan(task, written)) return undefined;
  return {
    task: { ...task, ...written, planConfirmed: false },
    event: new TaskPlanProposed(task.id),
  };
}

/** The user's Plan. Changing it leaves it unconfirmed, and a Ready Task goes back to Backlog. */
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
): TaskChange<TaskDefinitionOfDoneProposed> | undefined {
  const trimmed = trimmedStatements(statements);
  refuseWith([
    ...proposingProblems(task, "The Definition of Done"),
    ...definitionOfDoneProblems(trimmed),
  ]);
  if (sameStatements(trimmed, task.definitionOfDone)) return undefined;
  return {
    task: { ...task, definitionOfDone: trimmed, definitionOfDoneConfirmed: false },
    event: new TaskDefinitionOfDoneProposed(task.id),
  };
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
 * Task goes back to Backlog in the same save: nothing can start it in between. Moved here rather
 * than by `changeTaskState`, as nobody may ask for this move on its own.
 */
function savedPart<Event extends DomainEvent>(
  task: Task,
  saved: Task,
  announced: (leftReady: TaskStateChanged | undefined) => Event,
): TaskChange<Event> {
  if (task.state !== "ready") return { task: saved, event: announced(undefined) };
  return withStateChange(
    {
      task: { ...saved, state: "backlog" },
      event: announced(new TaskStateChanged(task.id, "ready", "backlog")),
    },
    task,
    THE_USER,
  );
}

/** That the Pipeline is in the library is checked by the caller. */
export function proposePipeline(
  task: Task,
  proposal: ProposedPipeline,
): TaskChange<TaskPipelineProposed> | undefined {
  const reason = proposal.reason.trim();
  const problems = proposingProblems(task, "A Pipeline");
  if (reason === "") problems.push("Say why the Pipeline fits the Definition of Done.");
  refuseWith(problems);
  const current = task.proposedPipeline;
  if (current?.pipelineId === proposal.pipelineId && current.reason === reason) return undefined;
  return {
    task: { ...task, proposedPipeline: { pipelineId: proposal.pipelineId, reason } },
    event: new TaskPipelineProposed(task.id, proposal.pipelineId),
  };
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
 * the Definition of Done are written.
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
  ];
}

/**
 * Auto mode accepts a Task marked planned, in one save: it confirms the Plan and the Definition of
 * Done if they aren't yet, and the proposed Pipeline if there is one (with none, the Task keeps the
 * Pipeline it follows; that a proposal is in the library is checked by the caller), then marks it
 * Ready under Ready's usual rules. Its state change names only what auto mode itself confirmed.
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
  let accepted = task;
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

function proposingProblems(task: Task, part: string): string[] {
  if (task.state === "planning") return [];
  return [
    `${part} is proposed while the Task is in Planning; this one is in ${TASK_STATE_NAMES[task.state]}.`,
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

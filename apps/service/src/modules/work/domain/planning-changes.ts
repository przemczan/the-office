import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { THE_USER } from "./author.js";
import { filesToChangeProblems, normalizedFilesToChange } from "./files-to-change.js";
import type { ProposedPipeline, Task } from "./task.js";
import { withStateChange, type TaskChange } from "./task-changes.js";
import {
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

/*
 * The Planner proposes the Plan, the Definition of Done and a Pipeline on a Task in Planning; the
 * user saves their own words until the Task starts, and confirms each part as it reads (spec §2.1,
 * §2.3). Writing a part again, by either, leaves it unconfirmed; the same words change nothing. The
 * Plan's files to change go with it: written, saved and confirmed together.
 */

/** A Plan as written: its words, the files it expects to change and its token estimate. */
export interface PlanWriting {
  readonly plan: string;
  /** Undefined keeps those the Task has. */
  readonly filesToChange?: readonly string[] | undefined;
  /** Undefined keeps the Task's own. */
  readonly estimatedTokens?: number | undefined;
}

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

type WrittenPlan = Pick<Task, "plan" | "filesToChange" | "estimatedTokens">;

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

function writtenPlanProblems({ plan, filesToChange, estimatedTokens }: WrittenPlan): string[] {
  return [
    ...planProblems(plan),
    ...filesToChangeProblems(filesToChange),
    ...estimatedTokensProblems(estimatedTokens),
  ];
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
  const trimmed = statements.map((statement) => statement.trim());
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
  const trimmed = statements.map((statement) => statement.trim());
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

function planProblems(plan: string): string[] {
  return plan === "" ? ["The Plan can't be empty."] : [];
}

function estimatedTokensProblems(estimatedTokens: number | undefined): string[] {
  return estimatedTokens === undefined ||
    (Number.isSafeInteger(estimatedTokens) && estimatedTokens > 0)
    ? []
    : ["The token estimate must be a whole number above 0."];
}

function definitionOfDoneProblems(statements: readonly string[]): string[] {
  if (statements.length === 0) return ["A Definition of Done needs at least one statement."];
  if (statements.includes("")) return ["A statement of the Definition of Done can't be empty."];
  return [];
}

function sameStatements(given: readonly string[], kept: readonly string[]): boolean {
  return given.length === kept.length && given.every((statement, at) => statement === kept[at]);
}

function refuseWith(problems: readonly string[]): void {
  if (problems.length > 0) throw new TaskRefused(problems);
}

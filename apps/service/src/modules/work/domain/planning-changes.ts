import type { ProposedPipeline, Task } from "./task.js";
import type { TaskChange } from "./task-changes.js";
import {
  TaskDefinitionOfDoneConfirmed,
  TaskDefinitionOfDoneProposed,
  TaskPipelineConfirmed,
  TaskPipelineProposed,
  TaskPlanConfirmed,
  TaskPlanProposed,
} from "./task-events.js";
import { TaskRefused } from "./task-refused.js";
import { NOT_STARTED_STATES, TASK_STATE_NAMES } from "./task-states.js";

/*
 * The Planner proposes the Plan, the Definition of Done and a Pipeline on a Task in Planning; the
 * user confirms each, as proposed or edited, until the Task starts (spec §2.1, §2.3). The Planner
 * writing again makes a part proposed again; the same words change nothing.
 */

export function proposePlan(task: Task, plan: string): TaskChange<TaskPlanProposed> | undefined {
  const trimmed = plan.trim();
  refuseWith([...proposingProblems(task, "The Plan"), ...planProblems(trimmed)]);
  if (trimmed === task.plan) return undefined;
  return {
    task: { ...task, plan: trimmed, planConfirmed: false },
    event: new TaskPlanProposed(task.id),
  };
}

/** The user's Plan: the proposed one confirmed, or their own edit of it. */
export function confirmPlan(task: Task, plan: string): TaskChange<TaskPlanConfirmed> | undefined {
  const trimmed = plan.trim();
  refuseWith([...confirmingProblems(task, "Plan"), ...planProblems(trimmed)]);
  if (trimmed === task.plan && task.planConfirmed) return undefined;
  return {
    task: { ...task, plan: trimmed, planConfirmed: true },
    event: new TaskPlanConfirmed(task.id),
  };
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

/** The user's Definition of Done: the proposed one confirmed, or their own edit of it. */
export function confirmDefinitionOfDone(
  task: Task,
  statements: readonly string[],
): TaskChange<TaskDefinitionOfDoneConfirmed> | undefined {
  const trimmed = statements.map((statement) => statement.trim());
  refuseWith([
    ...confirmingProblems(task, "Definition of Done"),
    ...definitionOfDoneProblems(trimmed),
  ]);
  if (sameStatements(trimmed, task.definitionOfDone) && task.definitionOfDoneConfirmed) {
    return undefined;
  }
  return {
    task: { ...task, definitionOfDone: trimmed, definitionOfDoneConfirmed: true },
    event: new TaskDefinitionOfDoneConfirmed(task.id),
  };
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
  refuseWith(confirmingProblems(task, "Pipeline"));
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

function confirmingProblems(task: Task, part: string): string[] {
  if (NOT_STARTED_STATES.includes(task.state)) return [];
  return [`A Task keeps its ${part} once it has started.`];
}

function planProblems(plan: string): string[] {
  return plan === "" ? ["The Plan can't be empty."] : [];
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

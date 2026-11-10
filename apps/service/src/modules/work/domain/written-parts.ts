import { filesToChangeProblems, normalizedFilesToChange } from "./files-to-change.js";
import type { Task } from "./task.js";

/*
 * The Plan and the Definition of Done as written, by the user, the Planner or whoever creates the
 * Task with both (spec §2.1), and why they can't be the Task's as they read.
 */

/** A Plan as written: its words, the files it expects to change and its token estimate. */
export interface PlanWriting {
  readonly plan: string;
  /** Undefined keeps those the Task has. */
  readonly filesToChange?: readonly string[] | undefined;
  /** Undefined keeps the Task's own. */
  readonly estimatedTokens?: number | undefined;
}

/** Both parts given with a new Task: Ready needs both, so one alone is never taken. */
export interface WrittenPlanAndDefinitionOfDone {
  readonly plan: PlanWriting;
  readonly definitionOfDone: readonly string[];
}

export type WrittenPlan = Pick<Task, "plan" | "filesToChange" | "estimatedTokens">;

type WrittenParts = WrittenPlan & Pick<Task, "definitionOfDone">;

const UNPLANNED: WrittenParts = {
  plan: "",
  filesToChange: [],
  estimatedTokens: undefined,
  definitionOfDone: [],
};

/**
 * Both parts as a new Task keeps them, with every reason they can't be kept; none given leaves the
 * Task unplanned.
 */
export function writtenParts(written: WrittenPlanAndDefinitionOfDone | undefined): {
  readonly parts: WrittenParts;
  readonly problems: readonly string[];
} {
  if (!written) return { parts: UNPLANNED, problems: [] };
  const { plan, definitionOfDone } = written;
  const parts: WrittenParts = {
    plan: plan.plan.trim(),
    filesToChange: normalizedFilesToChange(plan.filesToChange ?? []),
    estimatedTokens: plan.estimatedTokens,
    definitionOfDone: trimmedStatements(definitionOfDone),
  };
  return {
    parts,
    problems: [...writtenPlanProblems(parts), ...definitionOfDoneProblems(parts.definitionOfDone)],
  };
}

export function trimmedStatements(statements: readonly string[]): string[] {
  return statements.map((statement) => statement.trim());
}

export function writtenPlanProblems({
  plan,
  filesToChange,
  estimatedTokens,
}: WrittenPlan): string[] {
  return [
    ...planProblems(plan),
    ...filesToChangeProblems(filesToChange),
    ...estimatedTokensProblems(estimatedTokens),
  ];
}

export function planProblems(plan: string): string[] {
  return plan === "" ? ["The Plan can't be empty."] : [];
}

function estimatedTokensProblems(estimatedTokens: number | undefined): string[] {
  return estimatedTokens === undefined ||
    (Number.isSafeInteger(estimatedTokens) && estimatedTokens > 0)
    ? []
    : ["The token estimate must be a whole number above 0."];
}

export function definitionOfDoneProblems(statements: readonly string[]): string[] {
  if (statements.length === 0) return ["A Definition of Done needs at least one statement."];
  if (statements.includes("")) return ["A statement of the Definition of Done can't be empty."];
  return [];
}

/**
 * Whether a part of the Task is confirmed yet, as an Agent reads it: by the user or by auto mode,
 * which the Task's state changes say.
 */
export function confirmationWords(confirmed: boolean): string {
  return confirmed ? "confirmed" : "not yet confirmed";
}

/** The Plan as a Brief gives it: its words, then the files it expects to change. */
export function planWithFilesToChange({
  plan,
  filesToChange,
}: Pick<Task, "plan" | "filesToChange">): string {
  if (filesToChange.length === 0) return plan;
  return `${plan}\n\nFiles to change:\n${filesToChange.map((path) => `- ${path}`).join("\n")}`;
}

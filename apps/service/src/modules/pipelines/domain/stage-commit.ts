import type { StageOutcome, StageRun } from "./stage-run.js";
import type { AcceptedIssue } from "./walk-decisions.js";

/** git's own advice for a subject line; longer ones are cut where a log shows them. */
const SUBJECT_LENGTH = 72;
const SHORT_COMMIT_LENGTH = 8;

/** Where The Office left the Task's worktree: on the Task's branch, at the commit it last left. */
export interface ExpectedHead {
  readonly commit: string;
  readonly branch: string;
}

/**
 * The message The Office commits a Stage's work with (spec §5.5): "<Stage>: <Task title>" as the
 * subject, so a log reads by Task and Stage (problem E of task 30), the Stage's whole result below
 * it, then the Handover note, then the issues the user chose to continue with so far (research §7),
 * each by its first line.
 */
export function stageCommitMessage(
  stageName: string,
  taskTitle: string,
  outcome: StageOutcome,
  accepted: readonly AcceptedIssue[] = [],
): string {
  const result = resultText(outcome);
  const subject = cut(`${stageName}: ${taskTitle.trim()}`, SUBJECT_LENGTH);
  const body = [
    result.trim(),
    outcome.handoverNote === undefined
      ? undefined
      : `Handover note:\n${outcome.handoverNote.trim()}`,
    accepted.length === 0 ? undefined : acceptedIssuesText(accepted),
  ].filter((part) => part !== undefined && part !== "");
  return [subject, ...body].join("\n\n");
}

function acceptedIssuesText(accepted: readonly AcceptedIssue[]): string {
  const lines = accepted.map(({ stageName, error }) => `- ${stageName}: ${firstLine(error)}`);
  return `Issues the user accepted:\n${lines.join("\n")}`;
}

/**
 * How the worktree's HEAD differs from where The Office left it, in a sentence's words; undefined
 * when it is there. A switched branch is told before a moved commit, as it explains it.
 */
export function headProblem(
  expected: ExpectedHead,
  actual: { readonly commit: string; readonly branch: string | undefined },
): string | undefined {
  if (actual.branch !== expected.branch) {
    const now = actual.branch === undefined ? "a detached HEAD" : `the branch ${actual.branch}`;
    return `the worktree is on ${now}, not the Task's branch ${expected.branch}`;
  }
  if (actual.commit !== expected.commit) {
    return `HEAD moved from ${short(expected.commit)} to ${short(actual.commit)}`;
  }
  return undefined;
}

/** Whether the last run ended with the user keeping a branch that moved outside The Office. */
export function branchKept(runs: readonly StageRun[]): boolean {
  const decisions = runs.at(-1)?.decisions ?? [];
  return decisions.some(
    ({ kind, answer }) => kind === "branch-moved" && answer?.kind === "keep-branch",
  );
}

/** What the Stage's Agent is told of a branch that moved since the last Stage (spec §2.3). */
export function branchMovedWords(from: string, to: string): string {
  return `The Task's branch moved from ${short(from)} to ${short(to)} since the last Stage: read again whatever you read before.`;
}

function resultText(outcome: StageOutcome): string {
  switch (outcome.status) {
    case "done":
      return outcome.summary;
    case "needs-decision":
      return `Waiting on a Decision: ${outcome.question}`;
    case "failed":
      return `Failed: ${outcome.error}`;
  }
}

function firstLine(text: string): string {
  return text.trim().split("\n", 1)[0]?.trim() ?? "";
}

function cut(text: string, length: number): string {
  return text.length <= length ? text : `${text.slice(0, length - 1).trimEnd()}…`;
}

function short(commit: string): string {
  return commit.slice(0, SHORT_COMMIT_LENGTH);
}

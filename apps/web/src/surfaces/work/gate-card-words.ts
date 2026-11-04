import type { Attachment, ChangedFile, Task, TaskStage, TestResult } from "@the-office/contracts";
import { attachmentRounds } from "../../shell/attachments/attachment-rounds.ts";
import type { WaitingGate } from "../../shell/work/gate-words.ts";
import { reportedMetCount } from "./planning-words.ts";

/** What the Gate asks of the user, as the card and its slim bar say it. */
export function gateQuestion({ next }: Pick<WaitingGate, "next">): string {
  return next
    ? `Look at the changes and let the work continue to ${next.name}`
    : "Look at the changes and let the work finish";
}

/** The lines the Task changed; a binary file has none to count. */
export function linesChanged(files: readonly ChangedFile[]): {
  readonly added: number;
  readonly removed: number;
} {
  return {
    added: files.reduce((sum, { lines }) => sum + (lines?.added ?? 0), 0),
    removed: files.reduce((sum, { lines }) => sum + (lines?.removed ?? 0), 0),
  };
}

/**
 * The checks a Gate answers for: those before it. One after it, such as a Build, hasn't had its
 * turn, so it says nothing about the work the Gate shows.
 */
export function testsBeforeGate(
  results: readonly TestResult[],
  taskStages: readonly TaskStage[],
  { gate }: Pick<WaitingGate, "gate">,
): TestResult[] {
  const gateAt = taskStages.findIndex(({ stage }) => stage.key === gate.key);
  const before = taskStages.slice(0, gateAt).map(({ stage }) => stage.key);
  return results.filter(({ stageKey }) => before.includes(stageKey));
}

/** Of the checks before the Gate: "2 failed"; else "Not run" if any didn't, or none is; else "Passed". */
export function testsFact(results: readonly TestResult[]): string {
  const failed = results.filter(({ state }) => state === "failed").length;
  if (failed > 0) return `${failed} failed`;
  const allPassed = results.length > 0 && results.every(({ state }) => state === "passed");
  return allPassed ? "Passed" : "Not run";
}

/** The Reported met count, from the service's numbers. */
export function definitionOfDoneFact(
  { definitionOfDone }: Pick<Task, "definitionOfDone">,
  met: readonly number[],
): string {
  return `${reportedMetCount(definitionOfDone, met)} of ${definitionOfDone.length}`;
}

/** The pictures of the current round; the rest of the round's Attachments stay in the tab. */
export function picturesOfThisRound(
  attachments: readonly Attachment[],
  taskStages: readonly TaskStage[],
): Attachment[] {
  const thisRound = attachmentRounds(attachments, taskStages).at(-1)?.attachments ?? [];
  return thisRound.filter(({ kind }) => kind === "image");
}

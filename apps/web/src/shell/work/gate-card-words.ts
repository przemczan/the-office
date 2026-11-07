import type { Attachment, ChangedFile, Task, TaskStage, TestResult } from "@the-office/contracts";
import { attachmentsOfGateRun } from "../attachments/attachment-rounds.ts";
import type { WaitingGate } from "./gate-words.ts";
import { reportedMetCount } from "./work-words.ts";

/** What the Gate asks of the user, as the card and its slim bar say it. */
export function gateQuestion({ next }: Pick<WaitingGate, "next">): string {
  return next
    ? `Look at the changes and let the work continue to ${next.name}`
    : "Look at the changes and let the work finish";
}

/** What the card and the window are headed with: the Stage the Gate stands before, or, last, itself. */
export function gateHeading({ gate, next }: Pick<WaitingGate, "gate" | "next">): string {
  return next ? `Before ${next.name}` : gate.name;
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

/** The card's line of what the window shows as facts; the files are left out until they are known. */
export function gateFactsLine(
  filesChanged: number | undefined,
  checks: readonly TestResult[],
  definitionOfDone: string,
): string {
  const files =
    filesChanged === undefined
      ? []
      : [`${filesChanged} ${filesChanged === 1 ? "file" : "files"} changed`];
  return [...files, testsWords(checks), `Definition of Done ${definitionOfDone}`].join(" · ");
}

function testsWords(checks: readonly TestResult[]): string {
  const failed = checks.filter(({ state }) => state === "failed").length;
  if (failed > 0) return `${failed} ${failed === 1 ? "test" : "tests"} failed`;
  return `tests ${testsFact(checks).toLowerCase()}`;
}

/** The Attachments of the run the Gate waits in, of every kind. */
export function attachmentsOfThisRound(
  attachments: readonly Attachment[],
  taskStages: readonly TaskStage[],
  { gate }: Pick<WaitingGate, "gate">,
): Attachment[] {
  const waitingRun = taskStages.find(({ stage }) => stage.key === gate.key)?.runs.at(-1);
  if (waitingRun === undefined || waitingRun.gateAction !== null) return [];
  return attachmentsOfGateRun(attachments, taskStages, waitingRun);
}

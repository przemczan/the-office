import type { Task } from "@the-office/contracts";
import { NOT_STARTED } from "../../shell/work/work-words.ts";
import { firstLine } from "./stage-words.ts";

/** The Definition of Done as the user writes it, one statement per line; blank lines say nothing. */
export function statementsOf(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** How many of the statements are among the numbers Reported met, counted from 1. */
export function reportedMetCount(statements: readonly string[], met: readonly number[]): number {
  return statements.filter((_, index) => met.includes(index + 1)).length;
}

/** The Definition of Done's folded line: where it stands before Start, Reported met from then on. */
export function definitionOfDoneSummary(
  task: Pick<Task, "state" | "definitionOfDone" | "definitionOfDoneConfirmed">,
  met: readonly number[],
): string {
  const statements = task.definitionOfDone;
  if (statements.length === 0) return "Not written yet";
  if (!NOT_STARTED.includes(task.state)) {
    return `${reportedMetCount(statements, met)} of ${statements.length} Reported met`;
  }
  const count = `${statements.length} ${statements.length === 1 ? "statement" : "statements"}`;
  return task.definitionOfDoneConfirmed ? count : `${count} · not confirmed yet`;
}

/** The Plan's folded line: its first line without its Markdown marks, and the files it expects. */
export function planSummary({ plan, filesToChange }: Pick<Task, "plan" | "filesToChange">): string {
  if (plan === "") return "No Plan yet";
  const opening = firstLine(plan)
    .replace(/^\s*(?:#+|[-*+]|\d+\.)\s+/, "")
    .replace(/\*\*|__/g, "");
  if (filesToChange.length === 0) return opening;
  return `${opening} · ${filesToChange.length} ${filesToChange.length === 1 ? "file" : "files"}`;
}

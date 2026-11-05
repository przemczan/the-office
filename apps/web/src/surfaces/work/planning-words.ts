import type { Task } from "@the-office/contracts";
import { NOT_STARTED, reportedMetCount } from "../../shell/work/work-words.ts";
import { firstLine, withoutMarkdownMarks } from "./stage-words.ts";

/** The Definition of Done as the user writes it, one statement per line; blank lines say nothing. */
export function statementsOf(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** What a changing Save does to a Ready Task, said before it happens. */
export function leavesReadyWords(queued: boolean): string {
  const move = queued ? "takes this Task out of the queue and moves it" : "moves this Task";
  return `Saving a change ${move} to Backlog, to confirm and mark Ready again.`;
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

/** What an empty Description reads, as the service words it in the Agents' Briefs. */
export const NO_DESCRIPTION = "None: the title is all there is.";

/** The Description's folded line: its first line without its Markdown marks. */
export function descriptionSummary({ description }: Pick<Task, "description">): string {
  return description === "" ? "None" : withoutMarkdownMarks(firstLine(description));
}

/** The Plan's folded line: its first line without its Markdown marks, and the files it expects. */
export function planSummary({ plan, filesToChange }: Pick<Task, "plan" | "filesToChange">): string {
  if (plan === "") return "No Plan yet";
  const opening = withoutMarkdownMarks(firstLine(plan));
  if (filesToChange.length === 0) return opening;
  return `${opening} · ${filesToChange.length} ${filesToChange.length === 1 ? "file" : "files"}`;
}

import type { Attachment } from "./attachment.js";
import { attachmentsSection, planSections } from "./planning.js";
import type { Task } from "./task.js";
import { descriptionSection } from "./task-description.js";

/**
 * What a person does in their own Thread on a Task (spec §2.4): the same for every session of it,
 * so it stays in the cached prefix.
 */
export const ASKING_INSTRUCTIONS =
  "In this Thread the user asks you about a Task: what was done on it, why, and what its worktree holds. You read the worktree as it is at this moment, and a Stage may be working in it beside you. You change nothing: no edits, and no commands that change it. Changes go through a Stage: the user sends the work back at the Gate, or writes into a running Stage's Thread in its Stage history. Asking you holds nothing: only Continue, Send back and Drop act at the Gate.";

/** What the first session of a person's Thread on a Task is briefed from: the record alone. */
export interface AskingRecord {
  readonly task: Task;
  readonly projectName: string;
  readonly worktree: { readonly path: string; readonly branch: string };
  readonly attachments: readonly Attachment[];
  /** Each Stage run's result, as a line. */
  readonly stageResults: readonly string[];
  /** What changed on the Task's branch so far; undefined when nothing has, or it can't be read. */
  readonly diffSummary: string | undefined;
  /** The person's own Handover notes on the Task. */
  readonly handoverNotes: readonly string[];
}

/**
 * The first session's Brief of a person's Thread on a Task (spec §2.5): its title, Description,
 * Plan, Definition of Done, Stage results, the diff so far and the person's Handover notes.
 * Conversations adds the answered Decisions.
 */
export function askingBrief({
  task,
  projectName,
  worktree,
  attachments,
  stageResults,
  diffSummary,
  handoverNotes,
}: AskingRecord): string {
  return [
    "The user wants to ask you about a Task, in your own Thread on it.",
    `## The Task\n\n${task.title} (Task ${task.id}), in the Project ${projectName}.`,
    descriptionSection(task.description),
    `## Where you read\n\nThe Task's worktree, at ${worktree.path} on the branch ${worktree.branch}.`,
    ...planSections(task),
    attachmentsSection(attachments),
    stageResults.length === 0 ? undefined : `## Stage results\n\n${stageResults.join("\n")}`,
    diffSummary === undefined ? undefined : `## What changed so far\n\n${diffSummary}`,
    handoverNotes.length === 0
      ? undefined
      : `## Your Handover notes on this Task\n\n${handoverNotes.join("\n\n")}`,
  ]
    .filter((section) => section !== undefined)
    .join("\n\n");
}

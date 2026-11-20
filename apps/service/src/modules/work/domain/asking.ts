import type { PromptTexts } from "../../prompt-templates/index.js";
import type { Attachment } from "./attachment.js";
import { attachmentValues, planValues, worktreeValues } from "./planning.js";
import { renderedText } from "./rendered-text.js";
import type { Task } from "./task.js";
import { descriptionWords } from "./task-description.js";
import { ASKING_BRIEF, ASKING_INSTRUCTIONS } from "./work-prompt-templates.js";

/**
 * What a person does in their own Thread on a Task (spec §2.4): the same for every session of it,
 * so it stays in the cached prefix.
 */
export function askingInstructions(prompts: PromptTexts): string {
  return renderedText(prompts, ASKING_INSTRUCTIONS, {});
}

/** What the first session of a person's Thread on a Task is briefed from: the record alone. */
export interface AskingRecord {
  readonly task: Task;
  readonly projectName: string;
  /** Undefined while the Task has none yet. */
  readonly worktree: { readonly path: string; readonly branch: string } | undefined;
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
export function askingBrief(
  prompts: PromptTexts,
  {
    task,
    projectName,
    worktree,
    attachments,
    stageResults,
    diffSummary,
    handoverNotes,
  }: AskingRecord,
): string {
  return renderedText(prompts, ASKING_BRIEF, {
    taskTitle: task.title,
    taskId: task.id,
    projectName,
    description: descriptionWords(task.description),
    ...worktreeValues(worktree),
    ...planValues(task),
    ...attachmentValues(attachments),
    hasStageResults: stageResults.length > 0,
    stageResults,
    diffSummary: diffSummary ?? "",
    handoverNotes: handoverNotes.join("\n\n"),
  });
}

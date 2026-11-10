import { attachmentLines, HOW_TO_READ_ATTACHMENTS } from "./attachment.js";
import { initiativeTaskLine, outcomeWords, type InitiativeRecord } from "./record-words.js";
import type { Task } from "./task.js";
import { confirmationWords, planWithFilesToChange } from "./written-parts.js";

/** A Plan longer than this is left to read_task, so a large Initiative keeps the Brief small. */
export const LONG_PLAN_CHARACTERS = 2000;

/**
 * The Initiative a Task is part of, as a planning Brief gives it (spec §2.5): its outcome, its
 * other Tasks in the order they were added, each with what it waits for and its Plan, and its
 * Attachments by id. The Task being planned is left out: its own links are in Linked records.
 */
export function initiativeSection(record: InitiativeRecord, taskId: string): string {
  const { initiative, tasks, blockers, attachments } = record;
  const otherTasks = tasks.filter((task) => task.id !== taskId);
  return [
    "## The Initiative",
    `This Task is part of ${initiative.name} (Initiative ${initiative.id}), ${initiative.state}.`,
    `Outcome:\n${outcomeWords(initiative)}`,
    otherTasks.length === 0
      ? "It has no other Tasks."
      : "Its other Tasks, in the order they were added:",
    ...otherTasks.map(
      (task) => `### ${initiativeTaskLine(task, blockers)}\n\n${otherTaskPlanWords(task)}`,
    ),
    attachments.length === 0
      ? `Attachments:\n${attachmentLines(attachments).join("\n")}`
      : `Attachments: ${HOW_TO_READ_ATTACHMENTS}\n\n${attachmentLines(attachments).join("\n")}`,
  ].join("\n\n");
}

function otherTaskPlanWords(task: Task): string {
  if (task.plan === "") return "No Plan yet.";
  const confirmation = confirmationWords(task.planConfirmed);
  if (task.plan.length > LONG_PLAN_CHARACTERS) {
    return `Its Plan, ${confirmation}, is long: read_task reads it.`;
  }
  return `Plan, ${confirmation}:\n\n${planWithFilesToChange(task)}`;
}

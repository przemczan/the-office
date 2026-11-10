import type { Idea } from "./idea.js";
import type { Initiative } from "./initiative.js";
import type { Task } from "./task.js";
import { isArchived } from "./task-archive.js";
import { TASK_STATE_NAMES } from "./task-states.js";

/**
 * The records a Task is linked to, one hop away: the Tasks it waits for (in the order of
 * `task.blockedBy`), the Tasks that wait for it, the Idea it was shaped from and its Initiative.
 */
export interface TaskLinks {
  readonly waitsFor: readonly Task[];
  readonly waitingForIt: readonly Task[];
  readonly idea: Idea | undefined;
  readonly initiative: Initiative | undefined;
}

/**
 * The records the Task is linked to as a section of a Brief, with how to read them in full; none
 * when it is linked to none.
 */
export function linkedRecordsSection(links: TaskLinks): string | undefined {
  const lines = linkedRecordLines(links);
  if (lines.length === 0) return undefined;
  return `## Linked records\n\n${lines.join("\n")}\n\nRead them with read_task, read_idea and read_initiative, and their Attachments with read_attachment: a text file or a PDF's text by its lines, a long one in slices or by searching it for a phrase, an image as a picture where the engine shows one, and any other file by its name, kind and size.`;
}

/**
 * Each record the Task is linked to as one line, with its title, id and state and the tool that
 * reads it in full; none when it is linked to none.
 */
export function linkedRecordLines(links: TaskLinks): string[] {
  return [
    ...links.waitsFor.map((task) => `- Waits for: ${blockerWords(task)}`),
    ...links.waitingForIt.map((task) => `- Waiting for it: ${linkedTaskWords(task)}`),
    ...(links.idea ? [`- Shaped from: ${linkedIdeaWords(links.idea)}`] : []),
    ...(links.initiative ? [`- Part of: ${linkedInitiativeWords(links.initiative)}`] : []),
  ];
}

/** A linked Task in a few words, marked when it is archived; `note` follows its state. */
export function linkedTaskWords(task: Task, note = ""): string {
  const archived = isArchived(task) ? ", archived" : "";
  return `${task.title} (Task ${task.id}), ${TASK_STATE_NAMES[task.state]}${note}${archived}; read_task reads it`;
}

/** A Task waited for, a Dropped one marked as no longer blocking. */
function blockerWords(task: Task): string {
  return linkedTaskWords(task, task.state === "dropped" ? ", so it no longer blocks" : "");
}

/** A linked Idea in a few words, with where it is. */
export function linkedIdeaWords(idea: Idea): string {
  return `${idea.title} (Idea ${idea.id}), ${whereOf(idea.projectId)}, ${idea.state}; read_idea reads it`;
}

/** In a Project or Office-wide, as an Agent reads an Idea's place. */
export function whereOf(projectId: string | undefined): string {
  return projectId === undefined ? "Office-wide" : `in the Project ${projectId}`;
}

/** A linked Initiative in a few words. */
export function linkedInitiativeWords(initiative: Initiative): string {
  return `${initiative.name} (Initiative ${initiative.id}), ${initiative.state}; read_initiative reads it`;
}

import { attachmentLines, type Attachment } from "./attachment.js";
import { authorWords } from "./author.js";
import type { Idea } from "./idea.js";
import type { Initiative } from "./initiative.js";
import { initiativeProjectIds } from "./initiative-changes.js";
import { confirmationWords } from "./planning.js";
import { stateChangeLines, type StateChange } from "./state-change.js";
import type { Task } from "./task.js";
import { NO_DESCRIPTION } from "./task-description.js";
import { TASK_STATE_NAMES } from "./task-states.js";

/**
 * A Task's record as an Agent reads it, through `read_task` or mentioned in a chat: its state,
 * priority, Tags and Pipeline, its Plan, Definition of Done and Attachments, the Idea it came from,
 * its Moves to another Project, the Tasks it waits for (`blockers`, in the order of
 * `task.blockedBy`), and its kept state changes with who or what made each.
 */
export function taskRecordText(
  task: Task,
  attachments: readonly Attachment[],
  blockers: readonly Task[],
  stateChanges: readonly StateChange[],
): string {
  return [
    `${task.title} (Task ${task.id})`,
    `- Project ${task.projectId}; ${TASK_STATE_NAMES[task.state]}; ${task.priority} priority; Pipeline ${task.pipelineId}`,
    ...(task.tags.length > 0 ? [`- Tags: ${task.tags.join(", ")}`] : []),
    `- Created by ${authorWords(task.createdBy)} on ${task.createdAt.toISOString()}`,
    ...(task.originIdeaId ? [`- Shaped from the Idea ${task.originIdeaId}`] : []),
    ...task.projectMoves.map(
      ({ from, to, at, by }) =>
        `- Moved from Project ${from} to Project ${to} by ${authorWords(by)} on ${at.toISOString()}`,
    ),
    ...(task.proposedPipeline
      ? [
          `- Proposed Pipeline ${task.proposedPipeline.pipelineId}, not yet confirmed by the user: ${task.proposedPipeline.reason}`,
        ]
      : []),
    "",
    "Description:",
    task.description === "" ? NO_DESCRIPTION : task.description,
    "",
    task.plan === "" ? "Plan:" : `Plan, ${confirmationWords(task.planConfirmed)}:`,
    task.plan === "" ? "No Plan yet." : task.plan,
    ...(task.filesToChange.length === 0
      ? []
      : ["", "Files to change:", ...task.filesToChange.map((path) => `- ${path}`)]),
    "",
    task.definitionOfDone.length === 0
      ? "Definition of Done:"
      : `Definition of Done, ${confirmationWords(task.definitionOfDoneConfirmed)}:`,
    ...(task.definitionOfDone.length === 0
      ? ["Not written yet."]
      : task.definitionOfDone.map((statement) => `- ${statement}`)),
    ...blockerLines(blockers),
    "",
    "Attachments:",
    ...attachmentLines(attachments),
    "",
    ...stateChangeLines(stateChanges),
  ].join("\n");
}

function blockerLines(blockers: readonly Task[]): string[] {
  if (blockers.length === 0) return [];
  return [
    "",
    "Must be Done before it can start:",
    ...blockers.map((blocker) => {
      const dropped = blocker.state === "dropped" ? ", so it no longer blocks" : "";
      return `- ${blocker.title} (Task ${blocker.id}), ${TASK_STATE_NAMES[blocker.state]}${dropped}`;
    }),
  ];
}

/**
 * An Initiative's record as an Agent reads it, in its Thread or mentioned in a chat: its state and
 * outcome, the Idea it was shaped from, its Attachments, and its Tasks in the order they were
 * added, each with its Project, state and the Tasks it waits for, looked up in `blockers`.
 */
export function initiativeRecordText(
  initiative: Initiative,
  tasks: readonly Task[],
  blockers: ReadonlyMap<string, Task>,
  attachments: readonly Attachment[],
): string {
  return [
    `${initiative.name} (Initiative ${initiative.id})`,
    `- ${initiative.state}; spans ${projectsWords(initiativeProjectIds(tasks))}`,
    `- Shaped from the Idea ${initiative.originIdeaId} by ${authorWords(initiative.createdBy)} on ${initiative.createdAt.toISOString()}`,
    "",
    "Outcome:",
    initiative.outcome === "" ? "Not written yet." : initiative.outcome,
    "",
    "Tasks:",
    ...(tasks.length === 0
      ? ["None yet."]
      : tasks.map((task) => initiativeTaskLine(task, blockers))),
    "",
    "Attachments:",
    ...attachmentLines(attachments),
  ].join("\n");
}

function projectsWords(projectIds: readonly string[]): string {
  if (projectIds.length === 0) return "no Project yet";
  return projectIds.map((projectId) => `the Project ${projectId}`).join(", ");
}

function initiativeTaskLine(task: Task, blockers: ReadonlyMap<string, Task>): string {
  const line = `- ${task.title} (Task ${task.id}), in the Project ${task.projectId}, ${TASK_STATE_NAMES[task.state]}`;
  if (task.blockedBy.length === 0) return line;
  const waitsFor = task.blockedBy.map((blockerId) => {
    const blocker = blockers.get(blockerId);
    return blocker
      ? `${blocker.title} (Task ${blocker.id}, ${TASK_STATE_NAMES[blocker.state]})`
      : `the Task ${blockerId}`;
  });
  return `${line}; must wait for ${waitsFor.join(", ")}`;
}

/**
 * An Idea's record as an Agent reads it, through `read_idea` or mentioned in a chat: its notes,
 * who captured it and when, its Attachments, and the Task or Initiative it was shaped into.
 */
export function ideaRecordText(idea: Idea, attachments: readonly Attachment[]): string {
  return [
    `${idea.title} (Idea ${idea.id})`,
    `- ${whereOf(idea.projectId)}; ${idea.state}${shapedIntoWords(idea)}`,
    `- Captured by ${authorWords(idea.capturedBy)} on ${idea.capturedAt.toISOString()}`,
    "",
    "Notes:",
    idea.notes === "" ? "None." : idea.notes,
    "",
    "Attachments:",
    ...attachmentLines(attachments),
  ].join("\n");
}

function shapedIntoWords({ taskId, initiativeId }: Idea): string {
  if (taskId) return ` into the Task ${taskId}`;
  return initiativeId ? ` into the Initiative ${initiativeId}` : "";
}

/** In a Project or Office-wide, as an Agent reads an Idea's place. */
export function whereOf(projectId: string | undefined): string {
  return projectId === undefined ? "Office-wide" : `in the Project ${projectId}`;
}

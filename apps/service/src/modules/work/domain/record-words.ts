import { attachmentLines, type Attachment } from "./attachment.js";
import { authorWords } from "./author.js";
import type { Idea } from "./idea.js";
import type { Initiative } from "./initiative.js";
import { initiativeProjectIds } from "./initiative-changes.js";
import {
  linkedIdeaWords,
  linkedInitiativeWords,
  linkedRecordLines,
  linkedTaskWords,
  type TaskLinks,
} from "./linked-records.js";
import { confirmationWords } from "./planning.js";
import { stateChangeLines, type StateChange } from "./state-change.js";
import type { Task } from "./task.js";
import { NO_DESCRIPTION } from "./task-description.js";
import { TASK_STATE_NAMES } from "./task-states.js";

/** A Handover note with the Stage and the Role whose person wrote it. */
export interface HandoverNote {
  readonly stageName: string;
  readonly roleKey: string;
  readonly note: string;
}

/** What every Stage of a Task did, in the order they ran. */
export interface AllStageResults {
  /** Each run's result as a line. */
  readonly lines: readonly string[];
  readonly handoverNotes: readonly HandoverNote[];
}

/** What a Task's record is worded from, besides the Task. */
export interface TaskRecordParts {
  readonly attachments: readonly Attachment[];
  readonly links: TaskLinks;
  readonly stageResults: AllStageResults;
  readonly stateChanges: readonly StateChange[];
}

/**
 * A Task's record as an Agent reads it, through `read_task` or mentioned in a chat: its state,
 * priority, Tags and Pipeline, its Plan, Definition of Done and Attachments, its Moves to another
 * Project, its linked records (one line each, never their own links), its Stage results with every
 * Handover note, and its kept state changes with who or what made each.
 */
export function taskRecordText(
  task: Task,
  { attachments, links, stageResults, stateChanges }: TaskRecordParts,
): string {
  return [
    `${task.title} (Task ${task.id})`,
    `- Project ${task.projectId}; ${TASK_STATE_NAMES[task.state]}; ${task.priority} priority; Pipeline ${task.pipelineId}`,
    ...(task.state === "planning" && task.autoMode ? ["- Planning in auto mode"] : []),
    ...(task.tags.length > 0 ? [`- Tags: ${task.tags.join(", ")}`] : []),
    `- Created by ${authorWords(task.createdBy)} on ${task.createdAt.toISOString()}`,
    ...(task.archivedAt
      ? [`- Archived on ${task.archivedAt.toISOString()}: off the board, its state as it was`]
      : []),
    ...task.projectMoves.map(
      ({ from, to, at, by }) =>
        `- Moved from Project ${from} to Project ${to} by ${authorWords(by)} on ${at.toISOString()}`,
    ),
    ...(task.proposedPipeline
      ? [
          `- Proposed Pipeline ${task.proposedPipeline.pipelineId}, not yet confirmed:${task.proposedPipeline.reason}`,
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
    "",
    "Linked records:",
    ...orNone(linkedRecordLines(links)),
    "",
    "Attachments:",
    ...attachmentLines(attachments),
    "",
    "Stage results:",
    ...orNone(stageResults.lines),
    ...handoverNoteLines(stageResults.handoverNotes),
    "",
    ...stateChangeLines(stateChanges),
  ].join("\n");
}

function orNone(lines: readonly string[]): readonly string[] {
  return lines.length === 0 ? ["None."] : lines;
}

function handoverNoteLines(notes: readonly HandoverNote[]): string[] {
  if (notes.length === 0) return [];
  return [
    "",
    "Handover notes:",
    ...notes.map(
      ({ stageName, roleKey, note }) => `- ${stageName}, by the Role ${roleKey}: ${note}`,
    ),
  ];
}

/**
 * An Initiative's record as an Agent reads it, in its Thread or mentioned in a chat: its state and
 * outcome, the Idea it was shaped from (`idea`), its Attachments, and its Tasks in the order they
 * were added, each with its Project, state and the Tasks it waits for, looked up in `blockers`.
 */
export function initiativeRecordText(
  initiative: Initiative,
  idea: Idea,
  tasks: readonly Task[],
  blockers: ReadonlyMap<string, Task>,
  attachments: readonly Attachment[],
): string {
  return [
    `${initiative.name} (Initiative ${initiative.id})`,
    `- ${initiative.state}; spans ${projectsWords(initiativeProjectIds(tasks))}`,
    `- Shaped from: ${linkedIdeaWords(idea)}`,
    `- Created by ${authorWords(initiative.createdBy)} on ${initiative.createdAt.toISOString()}`,
    ...(initiative.endedAt
      ? [
          `- ${initiative.state === "done" ? "Done" : "Dropped"} on ${initiative.endedAt.toISOString()}`,
        ]
      : []),
    ...(initiative.archivedAt
      ? [`- Archived on ${initiative.archivedAt.toISOString()}: off the board, its state as it was`]
      : []),
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

/** The Task or Initiative an Idea was shaped into, if it was. */
export type ShapedInto =
  | { readonly kind: "task"; readonly task: Task }
  | { readonly kind: "initiative"; readonly initiative: Initiative };

/**
 * An Idea's record as an Agent reads it, through `read_idea` or mentioned in a chat: its notes,
 * who captured it and when, its Attachments, and the Task or Initiative it was shaped into.
 */
export function ideaRecordText(
  idea: Idea,
  shapedInto: ShapedInto | undefined,
  attachments: readonly Attachment[],
): string {
  return [
    `${idea.title} (Idea ${idea.id})`,
    `- ${whereOf(idea.projectId)}; ${idea.state}`,
    ...(shapedInto ? [`- Shaped into: ${shapedIntoWords(shapedInto)}`] : []),
    `- Captured by ${authorWords(idea.capturedBy)} on ${idea.capturedAt.toISOString()}`,
    "",
    "Notes:",
    idea.notes === "" ? "None." : idea.notes,
    "",
    "Attachments:",
    ...attachmentLines(attachments),
  ].join("\n");
}

function shapedIntoWords(shapedInto: ShapedInto): string {
  return shapedInto.kind === "task"
    ? linkedTaskWords(shapedInto.task)
    : linkedInitiativeWords(shapedInto.initiative);
}

/** In a Project or Office-wide, as an Agent reads an Idea's place. */
export function whereOf(projectId: string | undefined): string {
  return projectId === undefined ? "Office-wide" : `in the Project ${projectId}`;
}

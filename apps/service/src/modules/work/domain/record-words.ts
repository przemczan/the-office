import { initiativeBranchOf } from "./short-name.js";
import { attachmentLines, type Attachment } from "./attachment.js";
import { archivedByWords, authorWords, type ArchivedBy, type Author } from "./author.js";
import type { Idea } from "./idea.js";
import { initiativeProjectIds, pipelineIn, type Initiative } from "./initiative.js";
import {
  linkedIdeaWords,
  linkedInitiativeWords,
  linkedRecordLines,
  linkedTaskWords,
  type TaskLinks,
  whereOf,
} from "./linked-records.js";
import { stateChangeLines, type StateChange } from "./state-change.js";
import { isPublishingTask, type Task } from "./task.js";
import { commitMessageOf } from "./task-commit-message.js";
import { NO_DESCRIPTION } from "./task-description.js";
import { TASK_STATE_NAMES } from "./task-states.js";
import { confirmationWords } from "./written-parts.js";

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

/**
 * A Decision on a Task waiting on the user, which Conversations keeps: by its id, which a person
 * answers it for the user by when they ask (spec §2.4), with its questions in order, each with its
 * options, none for a question answered in words.
 */
export interface DecisionWaitingOnTheUser {
  readonly id: string;
  readonly questions: readonly {
    readonly question: string;
    readonly options: readonly string[];
  }[];
  /** Whether it asks approval of a call, which only the user gives. */
  readonly approval: boolean;
}

/** What a Task's record is worded from, besides the Task. */
export interface TaskRecordParts {
  readonly attachments: readonly Attachment[];
  readonly links: TaskLinks;
  readonly stageResults: AllStageResults;
  readonly stateChanges: readonly StateChange[];
  readonly decisionsWaiting: readonly DecisionWaitingOnTheUser[];
}

function pipelineWords({ pipelineId }: Task): string {
  return pipelineId === undefined ? "no Pipeline yet" : `Pipeline ${pipelineId}`;
}

/**
 * A Task's record as an Agent reads it, through `read_task` or mentioned in a chat: its state,
 * priority, Tags and Pipeline, its Plan, Definition of Done and Attachments, its Moves to another
 * Project, its linked records (one line each, never their own links), its Decisions waiting on the
 * user with their numbered options, its Stage results with every Handover note, and its kept state
 * changes with who or what made each.
 */
export function taskRecordText(
  task: Task,
  { attachments, links, stageResults, stateChanges, decisionsWaiting }: TaskRecordParts,
): string {
  return [
    `${task.title} (Task ${task.id})`,
    `- Project ${task.projectId}; ${TASK_STATE_NAMES[task.state]}; ${task.priority} priority; ${pipelineWords(task)}`,
    ...(task.state === "planning" && task.autoMode ? ["- Planning in auto mode"] : []),
    ...publishingTaskLines(task, links),
    ...(task.tags.length > 0 ? [`- Tags: ${task.tags.join(", ")}`] : []),
    `- Created by ${authorWords(task.createdBy)} on ${task.createdAt.toISOString()}`,
    ...archiveLines(task),
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
    ...commitMessageLines(task),
    "",
    "Linked records:",
    ...orNone(linkedRecordLines(links)),
    "",
    "Attachments:",
    ...attachmentLines(attachments),
    "",
    "Decisions waiting on the user:",
    ...orNone(decisionsWaiting.flatMap(waitingDecisionLines)),
    "",
    "Stage results:",
    ...orNone(stageResults.lines),
    ...handoverNoteLines(stageResults.handoverNotes),
    "",
    ...stateChangeLines(stateChanges),
  ].join("\n");
}

/** The commit message Publish lands the Task as, saying when it is the default or published. */
function commitMessageLines(task: Task): string[] {
  const published = task.commitMessagePublishedAt
    ? `, published on ${task.commitMessagePublishedAt.toISOString()}`
    : "";
  const heading =
    task.commitMessage === ""
      ? `Commit message, none written, so Publish uses the default${published}:`
      : `Commit message${published}:`;
  return [heading, commitMessageOf(task)];
}

/**
 * Its last Restore, and its Archive while it is in it: by whom when that was kept (an Archive from
 * before it was names nobody).
 */
function archiveLines({
  archivedAt,
  archivedBy,
  restoredAt,
  restoredBy,
}: {
  readonly archivedAt?: Date | undefined;
  readonly archivedBy?: ArchivedBy | undefined;
  readonly restoredAt?: Date | undefined;
  readonly restoredBy?: Author | undefined;
}): string[] {
  const restored = restoredBy ? ` by ${authorWords(restoredBy)}` : "";
  const archived = archivedBy ? ` by ${archivedByWords(archivedBy)}` : "";
  return [
    ...(restoredAt
      ? [`- Restored from the Archive${restored} on ${restoredAt.toISOString()}`]
      : []),
    ...(archivedAt
      ? [`- Archived${archived} on ${archivedAt.toISOString()}: off the board, its state as it was`]
      : []),
  ];
}

/** What a Publishing Task does, on its record: it publishes its Initiative's whole change. */
function publishingTaskLines(task: Task, { initiative }: TaskLinks): string[] {
  if (!isPublishingTask(task) || initiative?.shortName === undefined) return [];
  return [
    `- Publishing Task: it publishes the Initiative's whole change in this Project from ${initiativeBranchOf(initiative.shortName)}, which its worktree holds itself, into the base branch`,
  ];
}

/**
 * A Decision waiting on the user: its id, then each question numbered from 1 with its options
 * numbered from 1, as answer_decision takes them.
 */
function waitingDecisionLines({ id, questions, approval }: DecisionWaitingOnTheUser) {
  return [
    `- Decision ${id}${approval ? ": an approval of a call, which only the user gives, on its card" : ""}`,
    ...questions.flatMap(({ question, options }, index) => [
      `  Question ${index + 1}: ${question}`,
      ...options.map((option, number) => `    ${number + 1}. ${option}`),
    ]),
  ];
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

/** What an Initiative's record and a planning Brief's Initiative section are worded from. */
export interface InitiativeRecord {
  readonly initiative: Initiative;
  /** The Idea it was shaped from; undefined for one created from none (create_initiative). */
  readonly idea?: Idea;
  /** Its Tasks, in the order they were added. */
  readonly tasks: readonly Task[];
  /** Every Task by its id, where the Tasks its Tasks wait for are looked up. */
  readonly blockers: ReadonlyMap<string, Task>;
  readonly attachments: readonly Attachment[];
  /** The names of the Pipelines it has in its Projects, by id, those the library still has. */
  readonly pipelineNames: ReadonlyMap<string, string>;
}

/**
 * An Initiative's record as an Agent reads it, in its Thread or mentioned in a chat: its state and
 * outcome, the Idea it was shaped from if any, its Attachments, and its Tasks in the order they were
 * added, each with its Project, state and the Tasks it waits for, its Publishing Tasks apart.
 */
export function initiativeRecordText({
  initiative,
  idea,
  tasks,
  blockers,
  attachments,
  pipelineNames,
}: InitiativeRecord): string {
  const ordinary = tasks.filter((task) => !isPublishingTask(task));
  const publishing = tasks.filter(isPublishingTask);
  return [
    `${initiative.name} (Initiative ${initiative.id})`,
    `- ${initiative.state}; spans ${projectsWords(initiativeProjectIds(tasks))}`,
    ...(idea ? [`- Shaped from: ${linkedIdeaWords(idea)}`] : []),
    `- Created by ${authorWords(initiative.createdBy)} on ${initiative.createdAt.toISOString()}`,
    ...(initiative.endedAt
      ? [
          `- ${initiative.state === "done" ? "Done" : "Dropped"} on ${initiative.endedAt.toISOString()}`,
        ]
      : []),
    ...archiveLines(initiative),
    ...initiativePipelineLines(initiative, initiativeProjectIds(tasks), pipelineNames),
    "",
    "Outcome:",
    outcomeWords(initiative),
    "",
    "Tasks:",
    ...(ordinary.length === 0
      ? ["None yet."]
      : ordinary.map((task) => `- ${initiativeTaskLine(task, blockers)}`)),
    ...(publishing.length === 0
      ? []
      : [
          "",
          "Publishing Tasks, each publishing the whole change in its Project:",
          ...publishing.map((task) => `- ${initiativeTaskLine(task, blockers)}`),
        ]),
    "",
    "Attachments:",
    ...attachmentLines(attachments),
  ].join("\n");
}

/**
 * The Initiative's Pipeline in each Project it spans (`projectIds`), its Short name and its branch
 * in each Project (spec 2.1, 5.5); a Project with None publishes Task by Task.
 */
export function initiativePipelineLines(
  initiative: Initiative,
  projectIds: readonly string[],
  pipelineNames: ReadonlyMap<string, string>,
): string[] {
  const { shortName } = initiative;
  const pipelineLines = projectIds.map((projectId) => {
    const pipelineId = pipelineIn(initiative, projectId);
    const name = pipelineId === undefined ? undefined : pipelineNames.get(pipelineId);
    const pipeline =
      pipelineId === undefined
        ? "None, so each of its Tasks publishes on its own"
        : name === undefined
          ? pipelineId
          : `${name} (${pipelineId})`;
    return `- Initiative's Pipeline in the Project ${projectId}: ${pipeline}`;
  });
  const branchLines =
    shortName === undefined
      ? []
      : initiative.branches.map(
          ({ projectId, madeAt }) =>
            `- Initiative's branch ${initiativeBranchOf(shortName)} in the Project ${projectId}, made on ${madeAt.toISOString()}`,
        );
  return [
    ...pipelineLines,
    ...(shortName === undefined ? [] : [`- Short name: ${shortName}`]),
    ...branchLines,
  ];
}

function projectsWords(projectIds: readonly string[]): string {
  if (projectIds.length === 0) return "no Project yet";
  return projectIds.map((projectId) => `the Project ${projectId}`).join(", ");
}

export function outcomeWords({ outcome }: Initiative): string {
  return outcome === "" ? "Not written yet." : outcome;
}

/** A Task of an Initiative: its Project, state and the Tasks it waits for, looked up in `blockers`. */
export function initiativeTaskLine(task: Task, blockers: ReadonlyMap<string, Task>): string {
  const line = `${task.title} (Task ${task.id}), in the Project ${task.projectId}, ${TASK_STATE_NAMES[task.state]}`;
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

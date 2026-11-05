import { READ_ONLY_SHELL_RULE } from "../../engine/index.js";
import { attachmentLines, type Attachment } from "./attachment.js";
import type { Idea } from "./idea.js";
import type { Task } from "./task.js";
import { descriptionSection } from "./task-description.js";

/** The Role that plans Tasks, by the key a hired Planner keeps (spec §2.2). */
export const PLANNER = "planner";

export const PLANNING_THREAD_TITLE = "Planning";

/**
 * What Make a plan asks the Planner first: the user has written nothing, so the Planner plans
 * from the record in the Brief (spec §2.1).
 */
export const MAKE_A_PLAN_OPENING =
  "Plan this Task from its title and its Description in your Brief: the user has nothing more to add yet. Read what you need in the worktree, then write the Plan, the Definition of Done and the Pipeline that fits, for the user to confirm. Open a Decision only for a choice that is the user's to make.";

/**
 * What the Planner does in a Task's planning Thread, after their card's instructions. The same for
 * every planning session, so it stays in the cached prefix.
 */
export const PLANNING_INSTRUCTIONS = `In this Thread you plan a Task with the user. You read the Task's worktree, its own branch at the freshly fetched base branch; you change no file, and ${READ_ONLY_SHELL_RULE}. With The Office's tools you read its records of Projects, people, Tasks and Ideas, and the Task's Attachments with read_attachment. Ask the user what you need to know, then agree with them on the Plan (how it will be done, and the files and folders it expects to change) and the Definition of Done (what must be true when it is done), and on the Pipeline that fits. Write each onto the Task as you agree on it, with write_plan (its files to change too, so Start can warn of another Task in progress changing the same), write_definition_of_done and propose_pipeline: each shows as proposed until the user confirms or edits it, and once the Plan and the Definition of Done are confirmed the user marks the Task Ready. Give the Task a few Tags to find it by with write_tags, reusing Tags already in use where they fit; they apply at once. The user may edit them on the Task, so read it with read_task before you rewrite one. When a choice is the user's to make, open a Decision with open_decision, with the options and the one you recommend, and end your turn: their answer comes as your next message.`;

/** The Project as a planning Brief names it. */
export interface PlanningProject {
  readonly name: string;
  readonly baseBranch: string;
  readonly commands: Readonly<Record<string, string>>;
}

/** A Pipeline in the library, as the Planner chooses one: when it fits, and its Stages. */
export interface PlanningPipeline {
  readonly id: string;
  readonly name: string;
  /** When to choose it, in a sentence. */
  readonly description: string;
  /** In order; an Agent Stage names the Role that works it. */
  readonly stages: readonly { readonly name: string; readonly role?: string }[];
}

/** What a planning Brief is assembled from: the Task's record, with no model call. */
export interface PlanningRecord {
  readonly task: Task;
  readonly project: PlanningProject;
  readonly worktree: { readonly path: string; readonly branch: string };
  /** The Idea the Task was shaped from, if it was. */
  readonly idea: Idea | undefined;
  readonly attachments: readonly Attachment[];
  /** The library's Pipelines, which the Planner proposes one of. */
  readonly pipelines: readonly PlanningPipeline[];
}

/**
 * A planning Thread's Brief (spec §2.5): the Task's title and Description, where it came from, its
 * Attachments, the Project's commands, the Pipelines to propose from, and the Plan and Definition of Done once
 * written, each marked proposed or confirmed.
 */
export function planningBrief({
  task,
  project,
  worktree,
  idea,
  attachments,
  pipelines,
}: PlanningRecord): string {
  return [
    "You are planning a Task with the user, in the Task's planning Thread.",
    `## The Task\n\n${task.title} (Task ${task.id}), in the Project ${project.name}.`,
    descriptionSection(task.description),
    `## Where you work\n\nThe Task's worktree, at ${worktree.path} on the branch ${worktree.branch}, which started from the freshly fetched ${project.baseBranch}.`,
    originSection(idea, task.description),
    attachmentsSection(attachments),
    `## The Project's commands\n\n${commandLines(project.commands).join("\n")}`,
    pipelinesSection(task, pipelines),
    task.plan === ""
      ? undefined
      : `## The Plan, ${confirmationWords(task.planConfirmed)}\n\n${task.plan}${filesToChangeLines(task)}`,
    task.definitionOfDone.length === 0
      ? undefined
      : `## The Definition of Done, ${confirmationWords(task.definitionOfDoneConfirmed)}\n\n${task.definitionOfDone.map((statement) => `- ${statement}`).join("\n")}`,
  ]
    .filter((section) => section !== undefined)
    .join("\n\n");
}

function filesToChangeLines({ filesToChange }: Task): string {
  if (filesToChange.length === 0) return "";
  return `\n\nFiles to change:\n${filesToChange.map((path) => `- ${path}`).join("\n")}`;
}

function attachmentsSection(attachments: readonly Attachment[]): string {
  const lines = attachmentLines(attachments).join("\n");
  if (attachments.length === 0) return `## Attachments\n\n${lines}`;
  return `## Attachments\n\nRead one with read_attachment, by its id.\n\n${lines}`;
}

function pipelinesSection(task: Task, pipelines: readonly PlanningPipeline[]): string {
  const nameOf = (id: string) => {
    const pipeline = pipelines.find((candidate) => candidate.id === id);
    return pipeline ? `${pipeline.name} (${id})` : id;
  };
  const choices = pipelines.map(
    ({ id, name, description, stages }) =>
      `- ${id}: ${name} (${stages.map((stage) => stage.name).join(" → ")}). ${description}`,
  );
  const proposal = task.proposedPipeline
    ? `You proposed ${nameOf(task.proposedPipeline.pipelineId)}: ${task.proposedPipeline.reason} It waits for the user to confirm it.`
    : undefined;
  return [
    `## The Pipelines\n\nThe Task follows ${nameOf(task.pipelineId)} until the user confirms another. Propose the one its Definition of Done needs with propose_pipeline:`,
    choices.join("\n"),
    proposal,
  ]
    .filter((part) => part !== undefined)
    .join("\n\n");
}

/** Whether a part of the Task is the user's word yet, as an Agent reads it. */
export function confirmationWords(confirmed: boolean): string {
  return confirmed ? "confirmed by the user" : "proposed, not yet confirmed by the user";
}

/** The Idea's notes are left out when they are the Description still, which the Brief has already. */
function originSection(idea: Idea | undefined, description: string): string {
  if (!idea) return "## Where it came from\n\nThe Task was created as it is, from no Idea.";
  if (idea.notes !== "" && idea.notes === description) {
    return `## Where it came from\n\nThe Idea "${idea.title}", whose notes are the Description.`;
  }
  const notes = idea.notes === "" ? "It has no notes." : idea.notes;
  return `## Where it came from\n\nThe Idea "${idea.title}". Its notes:\n\n${notes}`;
}

function commandLines(commands: Readonly<Record<string, string>>): string[] {
  return Object.entries(commands).map(([key, commandLine]) =>
    commandLine === "" ? `- ${key}: none` : `- ${key}: \`${commandLine}\``,
  );
}

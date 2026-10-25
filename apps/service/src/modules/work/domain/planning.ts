import { attachmentLines, type Attachment } from "./attachment.js";
import type { Idea } from "./idea.js";
import type { Task } from "./task.js";

/** The Role that plans Tasks, by the key a hired Planner keeps (spec §2.2). */
export const PLANNER = "planner";

export const PLANNING_THREAD_TITLE = "Planning";

/**
 * What the Planner does in a Task's planning Thread, after their card's instructions. The same for
 * every planning session, so it stays in the cached prefix.
 */
export const PLANNING_INSTRUCTIONS =
  "In this Thread you plan a Task with the user. You read the Task's worktree, its own branch at the freshly fetched base branch; you change no file and run only read-only git. With The Office's tools you read its records of Projects, people, Tasks and Ideas. Ask the user what you need to know, then agree with them on the Plan (how it will be done) and the Definition of Done (what must be true when it is done), and on the Pipeline that fits.";

/** The Office's first message in a new planning Thread, after the Brief. */
export const PLANNING_OPENING =
  "Read what you need of the Task and its worktree, then ask the user what is unclear, starting with what must be true when it is done. Keep it short: the user answers in this Thread.";

/**
 * The Office tools of a planning session: it reads records. Writing the Plan, the Definition of
 * Done and a proposed Pipeline onto the record comes with their own tools.
 */
export const PLANNING_OFFICE_TOOLS = [
  "list_projects",
  "list_people",
  "list_tasks",
  "read_task",
  "list_ideas",
  "read_idea",
] as const;

/** The Project as a planning Brief names it. */
export interface PlanningProject {
  readonly name: string;
  readonly baseBranch: string;
  readonly commands: Readonly<Record<string, string>>;
}

/** What a planning Brief is assembled from: the Task's record, with no model call. */
export interface PlanningRecord {
  readonly task: Task;
  readonly project: PlanningProject;
  readonly worktree: { readonly path: string; readonly branch: string };
  /** The Idea the Task was shaped from, if it was. */
  readonly idea: Idea | undefined;
  readonly attachments: readonly Attachment[];
}

/**
 * A planning Thread's Brief (spec §2.5): the Task's title, where it came from, its Attachments, the
 * Project's commands, and the Plan and Definition of Done once written.
 */
export function planningBrief({
  task,
  project,
  worktree,
  idea,
  attachments,
}: PlanningRecord): string {
  return [
    "You are planning a Task with the user, in the Task's planning Thread.",
    `## The Task\n\n${task.title} (Task ${task.id}), in the Project ${project.name}, on the Pipeline ${task.pipelineId} for now.`,
    `## Where you work\n\nThe Task's worktree, at ${worktree.path} on the branch ${worktree.branch}, which started from the freshly fetched ${project.baseBranch}.`,
    originSection(idea),
    `## Attachments\n\n${attachmentLines(attachments).join("\n")}`,
    `## The Project's commands\n\n${commandLines(project.commands).join("\n")}`,
    task.plan === "" ? undefined : `## The Plan\n\n${task.plan}`,
    task.definitionOfDone.length === 0
      ? undefined
      : `## The Definition of Done\n\n${task.definitionOfDone.map((statement) => `- ${statement}`).join("\n")}`,
  ]
    .filter((section) => section !== undefined)
    .join("\n\n");
}

function originSection(idea: Idea | undefined): string {
  if (!idea) return "## Where it came from\n\nThe Task was created as it is, from no Idea.";
  const notes = idea.notes === "" ? "It has no notes." : idea.notes;
  return `## Where it came from\n\nThe Idea "${idea.title}". Its notes:\n\n${notes}`;
}

function commandLines(commands: Readonly<Record<string, string>>): string[] {
  return Object.entries(commands).map(([key, commandLine]) =>
    commandLine === "" ? `- ${key}: none` : `- ${key}: \`${commandLine}\``,
  );
}

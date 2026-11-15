import { READ_ONLY_SHELL_RULE } from "../../engine/index.js";
import { attachmentLines, HOW_TO_READ_ATTACHMENTS, type Attachment } from "./attachment.js";
import type { Idea } from "./idea.js";
import { initiativeSection } from "./initiative-section.js";
import { linkedRecordsSection, type TaskLinks } from "./linked-records.js";
import type { InitiativeRecord } from "./record-words.js";
import type { StateChange } from "./state-change.js";
import type { Task } from "./task.js";
import { descriptionSection } from "./task-description.js";
import { taskWhoAskedSection } from "./who-asked.js";
import { confirmationWords, planWithFilesToChange } from "./written-parts.js";

export const PLANNING_THREAD_TITLE = "Planning";

/**
 * What Make a plan asks the Planner first: the user has written nothing, so the Planner plans
 * from the record in the Brief (spec §2.1). In auto mode the Planner marks the Task planned
 * rather than leave the parts for the user to confirm.
 */
export function makeAPlanOpening(autoMode: boolean): string {
  const then = autoMode ? "then mark it planned" : "for the user to confirm";
  return `Plan this Task from its title and its Description in your Brief, and from its Plan and Definition of Done when your Brief has them: rework those rather than start over. The user has nothing more to add yet. Read what you need in the worktree, then write the Plan, the Definition of Done and the Pipeline that fits, ${then}. Open a Decision only for a choice that is the user's to make.`;
}

/**
 * What the Planner is woken with in a Task's planning Thread that a restart of The Office cut short
 * (spec §2.4): mid-turn, or with background Sub-agents running, which a restart stops.
 */
export const PLANNING_AFTER_RESTART_OPENING =
  "The Office restarted and cut your planning of this Task short. Any Sub-agents you had running were stopped, and their results were lost: run again the ones you still need, then carry on planning where you left off.";

/**
 * What the Planner does in a Task's planning Thread, after their card's instructions. The same for
 * every planning session, so it stays in the cached prefix.
 */
export const PLANNING_INSTRUCTIONS = `In this Thread you plan a Task with the user. You read the Task's worktree, its own branch at the freshly fetched base branch; you change no file, and ${READ_ONLY_SHELL_RULE}. With The Office's tools you read its records of Projects, people, Tasks, Ideas and Initiatives, the Task's and any other, and any of their Attachments with read_attachment: a text file or a PDF's text by its lines, a long one in slices or by searching it for a phrase, an image as a picture where the engine shows one, and any other file by its name, kind and size. Ask the user what you need to know, then agree with them on the Plan (how it will be done, and the files and folders it expects to change) and the Definition of Done (what must be true when it is done), and on the Pipeline that fits. When the Task is part of an Initiative, your Brief has it: check its outcome, its other Tasks and its Attachments for anything that bears on this Task, and keep the Plan consistent with the other Tasks' Plans. Write each onto the Task as you agree on it, with write_plan (its files to change too, so Start can warn of another Task in progress changing the same), write_definition_of_done and propose_pipeline: each shows as proposed until the user confirms or edits it, and once the Plan and the Definition of Done are confirmed the user marks the Task Ready. Once the Plan, the Definition of Done and the Pipeline are written and nothing is left to ask, say so with mark_planned; your Brief says what follows. Give the Task a few Tags to find it by with write_tags, reusing Tags already in use where they fit; they apply at once. The user may edit them on the Task, so read it with read_task before you rewrite one. As part of the Plan, suggest the message of the one commit Publish lands the Task as with write_commit_message, following the commit convention the Project's own docs define (read its CLAUDE.md, AGENTS.md, README, CONTRIBUTING and the like for it), or with none the Task's title with a short summary below it; it applies at once, the Agent Stages update it as the work turns out, and mark_planned doesn't wait for it. When a choice is the user's to make, open a Decision with open_decision, with the options and the one you recommend, and end your turn: their answer comes as your next message.`;

/** The Project as a planning Brief names it. */
export interface PlanningProject extends ProjectCommandsInBrief {
  readonly name: string;
  readonly baseBranch: string;
  /** The Pipeline the Project's Tasks usually follow, named in the Brief of a Task with none. */
  readonly defaultPipeline: string;
}

/** A Project's install command and its other commands, as a Brief lists them. */
export interface ProjectCommandsInBrief {
  readonly installCommand: string;
  readonly commands: readonly {
    readonly key: string;
    readonly name: string;
    readonly commandLine: string;
  }[];
}

/**
 * A Pipeline, office-wide or a Project Pipeline, as the Planner chooses one: when it fits, and its
 * Stages, a Project Pipeline's as built from its base Pipeline.
 */
export interface PlanningPipeline {
  readonly id: string;
  readonly name: string;
  /** When to choose it, in a sentence. */
  readonly description: string;
  /** In order; an Agent Stage names the Role that works it. */
  readonly stages: readonly { readonly name: string; readonly role?: string }[];
  /** The Project whose Project Pipeline it is; undefined for an office-wide one. */
  readonly projectId?: string;
  /** The office-wide Pipeline a Project Pipeline is built from. */
  readonly basePipeline?: { readonly id: string; readonly name: string };
  /** Each reason it is Broken; absent or empty when it isn't, as an office-wide one never is. */
  readonly broken?: readonly string[];
}

/** What a planning Brief is assembled from: the Task's record, with no model call. */
export interface PlanningRecord {
  readonly task: Task;
  /** The Task's kept state changes, oldest first, which say who moved it to Planning. */
  readonly stateChanges: readonly StateChange[];
  readonly project: PlanningProject;
  readonly worktree: { readonly path: string; readonly branch: string };
  /** The records the Task is linked to: the Idea it was shaped from among them. */
  readonly links: TaskLinks;
  readonly attachments: readonly Attachment[];
  /** The library's Pipelines, which the Planner proposes one of. */
  readonly pipelines: readonly PlanningPipeline[];
  /** The Initiative the Task is part of, if it is. */
  readonly initiative?: InitiativeRecord | undefined;
  /** Its Initiative's branch, when the Task starts from one; undefined for the base branch. */
  readonly startsFrom?: InitiativeBranchStart | undefined;
}

/**
 * The Initiative's branch a Task starts from and publishes into, its Initiative having a Pipeline
 * in the Task's Project.
 */
export interface InitiativeBranchStart {
  readonly branch: string;
  /** The Initiative's Pipeline in the Task's Project, by name, which runs only in its Publishing Task. */
  readonly initiativePipeline: string;
}

/**
 * A planning Thread's Brief (spec §2.5): the Task's title, who created it and who moved it to
 * Planning, its Description, where it came from, its linked records, the Initiative it is part of, its Attachments, the Project's commands, the
 * Pipelines to propose from, and the Plan and Definition of Done once written, each marked
 * confirmed or not.
 */
export function planningBrief({
  task,
  stateChanges,
  project,
  worktree,
  links,
  attachments,
  pipelines,
  initiative,
  startsFrom,
}: PlanningRecord): string {
  return [
    "You are planning a Task with the user, in the Task's planning Thread.",
    `## The Task\n\n${task.title} (Task ${task.id}), in the Project ${project.name}.`,
    taskWhoAskedSection(task, stateChanges, "planning"),
    readySection(task),
    descriptionSection(task.description),
    `## Where you work\n\nThe Task's worktree, at ${worktree.path} on the branch ${worktree.branch}, which started from the freshly fetched ${startsFrom?.branch ?? project.baseBranch}.`,
    originSection(links.idea, task.description),
    linkedRecordsSection(links),
    initiative && initiativeSection(initiative, task.id),
    startsFrom && initiativeBranchSection(startsFrom, project.baseBranch),
    attachmentsSection(attachments),
    `## The Project's commands\n\n${commandLines(project).join("\n")}`,
    pipelinesSection(task, project, pipelines),
    autoModeSection(task),
    ...planSections(task),
  ]
    .filter((section) => section !== undefined)
    .join("\n\n");
}

/** What the Initiative's Pipeline means for the Task (spec §2.5; §2.3, "Publishing into an Initiative's branch"). */
function initiativeBranchSection(
  { branch, initiativePipeline }: InitiativeBranchStart,
  baseBranch: string,
): string {
  return `## The Initiative's branch\n\nThe Initiative has the Pipeline ${initiativePipeline} in this Project, so this Task starts from its branch ${branch} and publishes into it by merge, never into ${baseBranch} directly. The Initiative's Pipeline runs only in the Project's Publishing Task, which takes ${branch} into ${baseBranch} once its Tasks are done; this Task keeps a Pipeline of its own, the one you propose below.`;
}

/**
 * A Ready Task is planned already: writing a part takes it back to Planning, out of the queue, to
 * be marked Ready again, so the Planner writes only what the user asks for.
 */
function readySection(task: Task): string | undefined {
  if (task.state !== "ready") return undefined;
  return "## The Task is Ready\n\nIt is planned and waits to start. Writing its Plan, Definition of Done or Pipeline takes it back to Planning, out of the queue if it is queued, where it is marked planned and Ready again, so write a part only when the user asks you to change it. Answer their questions without writing anything otherwise.";
}

/** The Plan and the Definition of Done once written, each marked confirmed or not. */
export function planSections(task: Task): readonly (string | undefined)[] {
  return [
    task.plan === ""
      ? undefined
      : `## The Plan, ${confirmationWords(task.planConfirmed)}\n\n${planWithFilesToChange(task)}`,
    task.definitionOfDone.length === 0
      ? undefined
      : `## The Definition of Done, ${confirmationWords(task.definitionOfDoneConfirmed)}\n\n${task.definitionOfDone.map((statement) => `- ${statement}`).join("\n")}`,
  ];
}

export function attachmentsSection(attachments: readonly Attachment[]): string {
  const lines = attachmentLines(attachments).join("\n");
  if (attachments.length === 0) return `## Attachments\n\n${lines}`;
  return `## Attachments\n\n${HOW_TO_READ_ATTACHMENTS}\n\n${lines}`;
}

function pipelinesSection(
  task: Task,
  project: PlanningProject,
  pipelines: readonly PlanningPipeline[],
): string {
  const nameOf = (id: string) => {
    const pipeline = pipelines.find((candidate) => candidate.id === id);
    return pipeline ? `${pipeline.name} (${id})` : id;
  };
  const proposal = task.proposedPipeline
    ? `You proposed ${nameOf(task.proposedPipeline.pipelineId)}: ${task.proposedPipeline.reason} It waits for the user to confirm it.`
    : undefined;
  const current =
    task.pipelineId === undefined
      ? `The Task has no Pipeline yet; the Project's default is ${defaultPipelineWords(pipelines, project.defaultPipeline)}.`
      : `The Task follows ${nameOf(task.pipelineId)} until the user confirms another.`;
  return [
    `## The Pipelines\n\n${current} Propose the one its Definition of Done needs with propose_pipeline:`,
    ...pipelineGroups(
      [{ project, own: pipelines.filter(({ projectId }) => projectId !== undefined) }],
      pipelines.filter(({ projectId }) => projectId === undefined),
    ),
    proposal,
  ]
    .filter((part) => part !== undefined)
    .join("\n\n");
}

/** A Broken default can't be proposed, so the Brief says so where it names it. */
/** A Project's default Pipeline by name and id, with why it is Broken when it is. */
export function defaultPipelineWords(
  pipelines: readonly PlanningPipeline[],
  defaultPipeline: string,
): string {
  const pipeline = pipelines.find(({ id }) => id === defaultPipeline);
  const name = pipeline ? `${pipeline.name} (${defaultPipeline})` : defaultPipeline;
  return `${name}${brokenDefaultWords(pipelines, defaultPipeline)}`;
}

function brokenDefaultWords(
  pipelines: readonly PlanningPipeline[],
  defaultPipeline: string,
): string {
  const broken = pipelines.find(({ id }) => id === defaultPipeline)?.broken ?? [];
  return broken.length === 0 ? "" : `, which is Broken: ${broken.join(" ")} It can't be proposed`;
}

/** A Project with its own Pipelines, as a planning Brief lists them. */
export interface ProjectPipelinesInBrief {
  readonly project: Pick<PlanningProject, "name" | "defaultPipeline">;
  /** Its Project Pipelines, in any order: its default is listed first. */
  readonly own: readonly PlanningPipeline[];
}

/**
 * Each Project's own Pipelines first, its default first among them, then the office-wide ones;
 * one list when no Project has its own.
 */
export function pipelineGroups(
  projects: readonly ProjectPipelinesInBrief[],
  officeWide: readonly PlanningPipeline[],
): string[] {
  const withOwn = projects.filter(({ own }) => own.length > 0);
  if (withOwn.length === 0) return [pipelineLibraryLines(officeWide).join("\n")];
  return [
    ...withOwn.map(
      ({ project, own }) =>
        `${project.name}'s own Pipelines, which only its Tasks can follow:\n${pipelineLibraryLines(defaultFirst(own, project.defaultPipeline)).join("\n")}`,
    ),
    `Office-wide Pipelines:\n${pipelineLibraryLines(officeWide).join("\n")}`,
  ];
}

function defaultFirst(
  pipelines: readonly PlanningPipeline[],
  defaultPipeline: string,
): PlanningPipeline[] {
  return pipelines.toSorted(
    (one, other) => Number(other.id === defaultPipeline) - Number(one.id === defaultPipeline),
  );
}

/**
 * The Pipelines, one line each: its id, name, Stages and when it fits; a Project Pipeline names
 * its base Pipeline, and a Broken one why it can't be proposed.
 */
export function pipelineLibraryLines(pipelines: readonly PlanningPipeline[]): string[] {
  return pipelines.map(({ id, name, description, stages, basePipeline, broken = [] }) =>
    [
      `- ${id}: ${name} (${stages.map((stage) => stage.name).join(" → ")}).`,
      basePipeline && `Built from ${basePipeline.name}.`,
      description,
      broken.length > 0 ? `Broken: ${broken.join(" ")} It can't be proposed.` : undefined,
    ]
      .filter((part) => part !== undefined && part !== "")
      .join(" "),
  );
}

/** What marking the Task planned does: in auto mode, The Office accepts it; else the user does. */
function autoModeSection({ autoMode }: Task): string {
  return autoMode
    ? "## Auto mode\n\nOn: once you mark the Task planned with mark_planned and no Decision on it is open, The Office confirms the Plan, the Definition of Done and the proposed Pipeline and marks the Task Ready."
    : "## Auto mode\n\nOff: the user confirms the Plan, the Definition of Done and the Pipeline, and marks the Task Ready.";
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

/** Install, then each command by its key and name, with its line or "none" while not set. */
export function commandLines({ installCommand, commands }: ProjectCommandsInBrief): string[] {
  return [{ key: "install", name: "Install", commandLine: installCommand }, ...commands].map(
    ({ key, name, commandLine }) =>
      commandLine === "" ? `- ${key} (${name}): none` : `- ${key} (${name}): \`${commandLine}\``,
  );
}

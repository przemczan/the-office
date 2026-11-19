import { READ_ONLY_SHELL_RULE } from "../../engine/index.js";
import type { PromptTexts } from "../../prompt-templates/index.js";
import { attachmentLines, type Attachment } from "./attachment.js";
import type { Idea } from "./idea.js";
import { initiativeSection } from "./initiative-section.js";
import { linkedRecordsSection, type TaskLinks } from "./linked-records.js";
import type { InitiativeRecord } from "./record-words.js";
import { renderedText } from "./rendered-text.js";
import type { StateChange } from "./state-change.js";
import type { Task } from "./task.js";
import { descriptionWords } from "./task-description.js";
import { taskWhoAsked } from "./who-asked.js";
import {
  MAKE_A_PLAN_OPENING,
  PLANNING_AFTER_RESTART_OPENING,
  PLANNING_BRIEF,
  PLANNING_INSTRUCTIONS,
} from "./work-prompt-templates.js";
import { confirmationWords, planWithFilesToChange } from "./written-parts.js";

export const PLANNING_THREAD_TITLE = "Planning";

/**
 * What the Planner does in a Task's planning Thread, after their card's instructions. The same for
 * every planning session, so it stays in the cached prefix.
 */
export function planningInstructions(prompts: PromptTexts): string {
  return renderedText(prompts, PLANNING_INSTRUCTIONS, { readOnlyShellRule: READ_ONLY_SHELL_RULE });
}

/**
 * What Make a plan asks the Planner first: the user has written nothing, so the Planner plans
 * from the record in the Brief (spec §2.1). In auto mode the Planner marks the Task planned
 * rather than leave the parts for the user to confirm.
 */
export function makeAPlanOpening(prompts: PromptTexts, autoMode: boolean): string {
  return renderedText(prompts, MAKE_A_PLAN_OPENING, { autoMode });
}

/**
 * What the Planner is woken with in a Task's planning Thread that a restart of The Office cut short
 * (spec §2.4): mid-turn, or with background Sub-agents running, which a restart stops.
 */
export function planningAfterRestartOpening(prompts: PromptTexts): string {
  return renderedText(prompts, PLANNING_AFTER_RESTART_OPENING, {});
}

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

/**
 * Where a session on a Task with no worktree yet reads, as SessionPlaces gives it the Projects'
 * checkouts in its place.
 */
export const NO_WORKTREE_YET =
  "The Task has no worktree yet: The Office makes it when the Task starts. Until then you read each Project's checkout in your folder, as a chat does: at its base branch, or at the Task's Initiative's branch where it has one.";

/** What a planning Brief is assembled from: the Task's record, with no model call. */
export interface PlanningRecord {
  readonly task: Task;
  /** The Task's kept state changes, oldest first, which say who moved it to Planning. */
  readonly stateChanges: readonly StateChange[];
  readonly project: PlanningProject;
  /** Undefined while the Task has none yet, as one planned in its Initiative's Thread. */
  readonly worktree: { readonly path: string; readonly branch: string } | undefined;
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
 * Planning, its Description, where it came from, its linked records, the Initiative it is part of,
 * its Attachments, the Project's commands, the Pipelines to propose from, and the Plan and
 * Definition of Done once written, each marked confirmed or not.
 */
export function planningBrief(
  prompts: PromptTexts,
  {
    task,
    stateChanges,
    project,
    worktree,
    links,
    attachments,
    pipelines,
    initiative,
    startsFrom,
  }: PlanningRecord,
): string {
  const whoAsked = taskWhoAsked(task, stateChanges, "planning");
  return renderedText(prompts, PLANNING_BRIEF, {
    taskTitle: task.title,
    taskId: task.id,
    projectName: project.name,
    description: descriptionWords(task.description),
    createdBy: whoAsked.createdBy,
    movedToPlanningBy: whoAsked.movedBy,
    ready: task.state === "ready",
    ...worktreeValues(worktree),
    startsFrom: startsFrom?.branch ?? project.baseBranch,
    ...originValues(links.idea, task.description),
    linkedRecords: linkedRecordsSection(links) ?? "",
    initiative: initiative ? initiativeSection(initiative, task.id) : "",
    initiativeBranch: startsFrom?.branch ?? "",
    initiativePipeline: startsFrom?.initiativePipeline ?? "",
    baseBranch: project.baseBranch,
    ...attachmentValues(attachments),
    commands: commandLines(project).join("\n"),
    ...pipelineValues(task, project, pipelines),
    autoMode: task.autoMode,
    ...planValues(task),
  });
}

/** Where a Task's session reads, as a Brief's values: its worktree, when it has one. */
export function worktreeValues(
  worktree: { readonly path: string; readonly branch: string } | undefined,
): { worktree: boolean; worktreePath: string; worktreeBranch: string } {
  return {
    worktree: worktree !== undefined,
    worktreePath: worktree?.path ?? "",
    worktreeBranch: worktree?.branch ?? "",
  };
}

/** The Plan and the Definition of Done once written, each marked confirmed or not. */
export function planValues(task: Task): {
  plan: string;
  planConfirmation: string;
  hasDefinitionOfDone: boolean;
  definitionOfDone: readonly string[];
  definitionOfDoneConfirmation: string;
} {
  return {
    plan: task.plan === "" ? "" : planWithFilesToChange(task),
    planConfirmation: confirmationWords(task.planConfirmed),
    hasDefinitionOfDone: task.definitionOfDone.length > 0,
    definitionOfDone: task.definitionOfDone,
    definitionOfDoneConfirmation: confirmationWords(task.definitionOfDoneConfirmed),
  };
}

export function attachmentValues(attachments: readonly Attachment[]): {
  hasAttachments: boolean;
  attachments: string;
} {
  return {
    hasAttachments: attachments.length > 0,
    attachments: attachmentLines(attachments).join("\n"),
  };
}

function pipelineValues(
  task: Task,
  project: PlanningProject,
  pipelines: readonly PlanningPipeline[],
): {
  hasPipeline: boolean;
  pipelineName: string;
  defaultPipeline: string;
  pipelineLibrary: string;
  proposedPipeline: string;
  proposalReason: string;
} {
  const nameOf = (id: string) => {
    const pipeline = pipelines.find((candidate) => candidate.id === id);
    return pipeline ? `${pipeline.name} (${id})` : id;
  };
  return {
    hasPipeline: task.pipelineId !== undefined,
    pipelineName: task.pipelineId === undefined ? "" : nameOf(task.pipelineId),
    defaultPipeline: defaultPipelineWords(pipelines, project.defaultPipeline),
    pipelineLibrary: pipelineGroups(
      [{ project, own: pipelines.filter(({ projectId }) => projectId !== undefined) }],
      pipelines.filter(({ projectId }) => projectId === undefined),
    ).join("\n\n"),
    proposedPipeline: task.proposedPipeline ? nameOf(task.proposedPipeline.pipelineId) : "",
    proposalReason: task.proposedPipeline?.reason ?? "",
  };
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

/** The Idea's notes are left out when they are the Description still, which the Brief has already. */
function originValues(
  idea: Idea | undefined,
  description: string,
): { fromIdea: boolean; ideaTitle: string; ideaNotesAreDescription: boolean; ideaNotes: string } {
  return {
    fromIdea: idea !== undefined,
    ideaTitle: idea?.title ?? "",
    ideaNotesAreDescription: idea !== undefined && idea.notes !== "" && idea.notes === description,
    ideaNotes: idea?.notes ?? "",
  };
}

/** Install, then each command by its key and name, with its line or "none" while not set. */
export function commandLines({ installCommand, commands }: ProjectCommandsInBrief): string[] {
  return [{ key: "install", name: "Install", commandLine: installCommand }, ...commands].map(
    ({ key, name, commandLine }) =>
      commandLine === "" ? `- ${key} (${name}): none` : `- ${key} (${name}): \`${commandLine}\``,
  );
}

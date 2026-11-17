import type {
  Initiative,
  InitiativeState,
  Project,
  Stage,
  TaskStage,
  TaskState,
} from "@the-office/contracts";
import { NOT_STARTED } from "../../shell/work/work-words.ts";
import {
  currentStageIndex,
  stageWaitsForRunEnvironment,
  type LoopBack,
} from "./stage-rail-words.ts";
import { STAGE_STATE_WORDS, WAITING_FOR_RUN_ENVIRONMENT, type StageNames } from "./stage-words.ts";

/**
 * The words and layout of the Initiative page's Pipelines card (docs/design/README.md, "The
 * Initiative page: what it proposes", point 3): a block per Project the Initiative spans, each with
 * its own Pipeline or None, and a track of its Stages, across or stacked.
 */

/** What None does once whether a Project has a Pipeline is fixed. */
export const NONE_CONFIRMED = "None: publishes Task by Task";

/** The width a Stage needs across; a track that can't give each this much stacks. */
export const STAGE_ACROSS_PX = 96;

export type TrackLayout = "across" | "stacked";

/** Across when each Stage gets 96px of the track's own width, else stacked, a Stage a row. */
export function trackLayout(width: number, stageCount: number): TrackLayout {
  return width >= stageCount * STAGE_ACROSS_PX ? "across" : "stacked";
}

function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function hasGate(stages: readonly Stage[]): boolean {
  return stages.some(({ kind }) => kind === "gate");
}

/** "5 Stages, 1 Gate", or "3 Stages, no Gate". */
export function pipelineShapeWords(stages: readonly Stage[]): string {
  const gates = stages.filter(({ kind }) => kind === "gate").length;
  const gateWords = gates === 0 ? "no Gate" : counted(gates, "Gate", "Gates");
  return `${counted(stages.length, "Stage", "Stages")}, ${gateWords}`;
}

/** One Project the Initiative spans, as the folded and foot lines read it. */
export interface ProjectPublishing {
  readonly projectName: string;
  /** Its Pipeline's name; null for None. */
  readonly pipelineName: string | null;
  /** Its Publishing Task once added: its state and the Stages it walks. */
  readonly publishingTask:
    { readonly state: TaskState; readonly stages: readonly TaskStage[] } | undefined;
}

/**
 * The card's folded line, Project by Project: what each publishes through while shaping and before
 * the Publishing Tasks, where each Publishing Task is once they are added, then how it ended.
 */
export function pipelinesFoldedLine(
  state: InitiativeState,
  projects: readonly ProjectPublishing[],
  branchesKept: number,
): string {
  const withPipeline = projects.filter(({ pipelineName }) => pipelineName !== null);
  if (withPipeline.length === 0) {
    return state === "shaping" ? "None: each Task publishes on its own" : NONE_CONFIRMED;
  }
  const named = projects
    .map(({ projectName, pipelineName }) => `${projectName}: ${pipelineName ?? "None"}`)
    .join(" · ");
  if (state === "shaping") return named;
  if (state === "dropped") {
    return branchesKept === 0
      ? "Dropped · no Initiative's branch was made"
      : `Dropped · ${counted(branchesKept, "branch", "branches")} kept for you to delete`;
  }
  if (state === "done") {
    const published = withPipeline.filter(
      ({ publishingTask }) => publishingTask?.state === "done",
    ).length;
    return published === 0
      ? "Done · no Publishing Task was needed"
      : `Published in ${counted(published, "Project", "Projects")}`;
  }
  if (withPipeline.every(({ publishingTask }) => publishingTask === undefined)) {
    return `${named} · start once every Task is Done or Dropped`;
  }
  return withPipeline
    .map(({ projectName, publishingTask }) => `${projectName} ${whereItIs(publishingTask)}`)
    .join(" · ");
}

const HELD_WORDS: Readonly<Partial<Record<TaskStage["state"], string>>> = {
  "waiting-on-you": ", waiting on you",
  failed: ", failed",
  paused: ", paused",
  stopped: ", stopped",
};

/** Where a Project's Publishing Task is: "at Your review, waiting on you", "at Integrate". */
function whereItIs(publishingTask: ProjectPublishing["publishingTask"]): string {
  if (publishingTask === undefined) return "has no Publishing Task yet";
  const { state, stages } = publishingTask;
  if (state === "done") return "published";
  if (state === "dropped") return "dropped";
  if (NOT_STARTED.includes(state)) return "ready to start";
  const current = currentStageIndex(stages);
  const held = stages[current];
  if (held && held.state !== "done" && held.state !== "skipped") {
    return `at ${held.stage.name}${HELD_WORDS[held.state] ?? ""}`;
  }
  const next = stages.find(({ state: stageState }) => stageState === "pending");
  return next ? `at ${next.stage.name}` : "published";
}

/** Whether a Publishing Task has started walking its Stages, after which its Pipeline is fixed. */
export function hasStarted(state: TaskState): boolean {
  return !NOT_STARTED.includes(state) && state !== "dropped";
}

/**
 * The card's last line: what comes next for the Pipelines, or why they no longer change; undefined
 * when there is nothing to say, as once Done or with None in every Project.
 */
export function pipelinesFootWords(
  state: InitiativeState,
  projects: readonly ProjectPublishing[],
): string | undefined {
  const withPipeline = projects.filter(({ pipelineName }) => pipelineName !== null);
  if (withPipeline.length === 0) return undefined;
  if (state === "shaping") {
    return "Once every other Task is Done or Dropped, each Project with a Pipeline gets a Publishing Task that walks its Stages.";
  }
  if (state === "dropped") return "Dropped: no Publishing Task is added any more.";
  if (state === "done") return undefined;
  const added = withPipeline.flatMap(({ publishingTask }) => publishingTask ?? []);
  if (added.length === 0) {
    return "Once every other Task is Done or Dropped, The Office adds a Publishing Task in each Project with a Pipeline whose branch holds work, to publish its whole change; you start it, or Start Ready Tasks does. Another Pipeline for a Project comes by a Proposal of whoever shapes Initiatives.";
  }
  const started = added.filter(({ state: taskState }) => hasStarted(taskState)).length;
  if (started === 0)
    return "Another Pipeline for a Project comes by a Proposal of whoever shapes Initiatives.";
  return started === withPipeline.length
    ? "Their Publishing Tasks have started, so these Pipelines no longer change."
    : "A Project's Pipeline no longer changes once its Publishing Task has started.";
}

/** Whether the card starts open: folded only once confirmed with None in every Project. */
export function pipelinesStartOpen(initiative: Pick<Initiative, "state" | "pipelines">): boolean {
  return (
    initiative.state === "shaping" ||
    initiative.pipelines.some(({ pipelineId }) => pipelineId !== null)
  );
}

/** What a Project with None does, in its block's dashed line. */
export function noneLineWords(shaping: boolean): string {
  return shaping
    ? "None: its Tasks publish on their own, each as it is done. Choose a Pipeline to publish this Project's whole change at once, after its last Task, through the Stages it has."
    : "Its Tasks publish on their own, each as it is done: no Initiative's branch here, and no Publishing Task.";
}

/** Beside the Initiative's branch: "made at Confirm" while shaping, "kept for you to delete" once ended. */
export function branchNoteWords(state: InitiativeState): string | undefined {
  if (state === "shaping") return "made at Confirm";
  return state === "done" || state === "dropped" ? "kept for you to delete" : undefined;
}

/** How a Done Publishing Task published, by its Project's publishing mode. */
export function publishedWords(project: Pick<Project, "publishingMode" | "baseBranch">): string {
  return project.publishingMode === "merge"
    ? `Merged into ${project.baseBranch}`
    : `By a pull request into ${project.baseBranch}`;
}

/** Under a Stage's name: its state once its Publishing Task reached it, else who works it. */
export function trackStageWords(taskStage: TaskStage, who: string): string {
  if (taskStage.state === "pending") return who;
  return stageWaitsForRunEnvironment(taskStage)
    ? WAITING_FOR_RUN_ENVIRONMENT
    : STAGE_STATE_WORDS[taskStage.state];
}

/** A loop-back in words, as a stacked track says it: "Check failed: back to Integrate, round 1 of 2". */
export function stackedLoopBackWords(
  { from, to, count, rounds }: Pick<LoopBack, "from" | "to" | "count" | "rounds">,
  names: StageNames,
): string {
  return `${names(from)} failed: back to ${names(to)}, round ${count} of ${rounds}`;
}

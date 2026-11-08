import { isDeepStrictEqual } from "node:util";
import { ONBOARD_PIPELINE, SET_UP_RUN_ENVIRONMENT_PIPELINE } from "./built-in-pipelines.js";
import { stageProblems, type Pipeline, type StageProblem } from "./pipeline.js";
import { PipelineAdded, PipelineSaved } from "./pipeline-library-events.js";
import type { Stage } from "./stage.js";
import { staffingProblems, type RoleFilling } from "./stage-staffing.js";

/** What the user writes of a library Pipeline in the library editor; its id stays. */
export interface PipelineEdit {
  readonly name: string;
  readonly description: string;
  readonly stages: readonly Stage[];
}

/** A Task as the library weighs who uses a Pipeline. */
export interface TaskOnPipeline {
  readonly state: string;
  readonly pipelineId: string;
}

/** A Project as the library weighs who names a Pipeline as their default. */
export interface ProjectOnPipeline {
  readonly id: string;
  readonly name: string;
  readonly defaultPipeline: string;
}

/** Who uses a library Pipeline: what removing it would leave without one, and what saving changes. */
export interface PipelineUse {
  readonly defaultFor: readonly { readonly projectId: string; readonly name: string }[];
  readonly notStarted: number;
  readonly running: number;
}

/** States of a Task that hasn't started: it reads its library Pipeline when it does. */
const NOT_STARTED_STATES: readonly string[] = ["shaping", "backlog", "planning", "ready"];

/** States of a started Task still at work, on the copy of the Stages it started with. */
const RUNNING_STATES: readonly string[] = ["in-progress", "waiting-on-you", "paused"];

/**
 * Every reason the edited Pipeline can't be saved: the name is its own and the Stages can run. Who
 * fills each Role is only flagged (`pipelineEditFlags`), unlike in a Task's editor: the library
 * outlives who is hired and how (spec §2.3).
 */
export function pipelineEditProblems(
  edit: PipelineEdit,
  otherPipelines: readonly Pipeline[],
): StageProblem[] {
  return [...nameProblems(edit.name, otherPipelines), ...stageProblems(edit.stages)];
}

/**
 * What the editor flags but saves: Agent Stages whose Role nobody fills, or whose person's Task
 * limit is none. A Task's own Stage editor refuses both, so the Task can't start on them.
 */
export function pipelineEditFlags(
  edit: PipelineEdit,
  roles: ReadonlyMap<string, RoleFilling>,
): StageProblem[] {
  return staffingProblems(edit.stages, 0, roles);
}

/**
 * Every reason a Proposal of the Pipeline's new Stages (`to`) can't be saved on it now: its Stages
 * changed since the Proposal was drafted (`from`), nothing would change, or the new Stages break a
 * rule the library editor keeps. Its name and description stay.
 */
export function proposedStagesProblems(
  pipeline: Pipeline,
  from: readonly Stage[],
  to: readonly Stage[],
  otherPipelines: readonly Pipeline[],
): StageProblem[] {
  if (!sameStages(pipeline.stages, from)) {
    return [{ text: `${pipeline.name}'s Stages changed since this was proposed.` }];
  }
  if (sameStages(from, to)) {
    return [
      { text: "Nothing changes: give the Pipeline's Stages as they should be, all of them." },
    ];
  }
  return pipelineEditProblems(proposedEdit(pipeline, to), otherPipelines);
}

/** The Pipeline with a Proposal's Stages, under its own name and description. */
export function proposedEdit(pipeline: Pipeline, stages: readonly Stage[]): PipelineEdit {
  return { name: pipeline.name, description: pipeline.description, stages };
}

/** Stages alike as they are kept, where a field left out and one left undefined are the same. */
function sameStages(one: readonly Stage[], other: readonly Stage[]): boolean {
  return isDeepStrictEqual(asKept(one), asKept(other));
}

function asKept(stages: readonly Stage[]): unknown {
  return JSON.parse(JSON.stringify(stages));
}

/** A Pipeline made from scratch, which `pipelineEditProblems` allowed. */
export function addedPipeline(
  id: string,
  edit: PipelineEdit,
): { readonly pipeline: Pipeline; readonly event: PipelineAdded } {
  return { pipeline: pipelineOf(id, edit), event: new PipelineAdded(id) };
}

/** A library Pipeline as the user saved it, which `pipelineEditProblems` allowed. */
export function savedPipeline(
  id: string,
  edit: PipelineEdit,
): { readonly pipeline: Pipeline; readonly event: PipelineSaved } {
  return { pipeline: pipelineOf(id, edit), event: new PipelineSaved(id) };
}

/**
 * A copy of a library Pipeline under a name of its own, such as "Full (copy)". Its Stages are the
 * original's as they are, so the copy is never refused: the editor flags what needs fixing.
 */
export function copiedPipeline(
  id: string,
  original: Pipeline,
  library: readonly Pipeline[],
): { readonly pipeline: Pipeline; readonly event: PipelineAdded } {
  const taken = new Set(library.map(({ name }) => comparableName(name)));
  let name = `${original.name} (copy)`;
  for (let number = 2; taken.has(comparableName(name)); number += 1) {
    name = `${original.name} (copy ${number})`;
  }
  return {
    pipeline: { ...original, id, name },
    event: new PipelineAdded(id),
  };
}

/** Who uses the Pipeline among these Projects and Tasks. */
export function pipelineUse(
  pipelineId: string,
  projects: readonly ProjectOnPipeline[],
  tasks: readonly TaskOnPipeline[],
): PipelineUse {
  const onPipeline = tasks.filter((task) => task.pipelineId === pipelineId);
  return {
    defaultFor: projects
      .filter(({ defaultPipeline }) => defaultPipeline === pipelineId)
      .map(({ id, name }) => ({ projectId: id, name })),
    notStarted: onPipeline.filter(({ state }) => NOT_STARTED_STATES.includes(state)).length,
    running: onPipeline.filter(({ state }) => RUNNING_STATES.includes(state)).length,
  };
}

/**
 * Why the Pipeline can't be removed, in the UI's words; empty when it can. A Task that hasn't
 * started counts even when its Stages were edited for it: Start still needs its Pipeline.
 */
export function removalProblems(pipelineId: string, use: PipelineUse): string[] {
  const problems: string[] = [];
  if (pipelineId === ONBOARD_PIPELINE) {
    problems.push("Onboarding uses the Onboard Pipeline, so it stays in the library.");
  }
  if (pipelineId === SET_UP_RUN_ENVIRONMENT_PIPELINE) {
    problems.push(
      "Setting up a run environment uses the Set up run environment Pipeline, so it stays in the library.",
    );
  }
  if (use.defaultFor.length > 0) {
    const names = use.defaultFor.map(({ name }) => name).join(", ");
    problems.push(`It is the default Pipeline of ${names}; choose another default first.`);
  }
  if (use.notStarted === 1) {
    problems.push("A Task that hasn't started uses it; swap that Task's Pipeline first.");
  } else if (use.notStarted > 1) {
    problems.push(
      `${use.notStarted} Tasks that haven't started use it; swap their Pipeline first.`,
    );
  }
  return problems;
}

function nameProblems(name: string, otherPipelines: readonly Pipeline[]): StageProblem[] {
  const trimmed = name.trim();
  if (trimmed === "") return [{ text: "Give the Pipeline a name." }];
  const named = comparableName(trimmed);
  return otherPipelines.some((other) => comparableName(other.name) === named)
    ? [{ text: `Another Pipeline is named "${trimmed}".` }]
    : [];
}

function pipelineOf(id: string, { name, description, stages }: PipelineEdit): Pipeline {
  return { id, name: name.trim(), description: description.trim(), stages };
}

function comparableName(name: string): string {
  return name.trim().toLowerCase();
}

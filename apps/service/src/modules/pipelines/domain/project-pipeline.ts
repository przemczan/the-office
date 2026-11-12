import { isDeepStrictEqual } from "node:util";
import type { Pipeline, StageProblem } from "./pipeline.js";
import { UnknownProjectPipeline } from "./pipeline-library-refusals.js";
import { PipelineAdded, PipelineSaved } from "./pipeline-library-events.js";
import { pipelineNameProblems, type TakenName } from "./pipeline-names.js";
import {
  buildStages,
  emptyChangeIndexes,
  type BrokenReason,
  type BuiltStage,
  type BuiltStages,
  type EditedStageChange,
  type StageChange,
} from "./stage-change.js";
import type { Stage } from "./stage.js";

/**
 * A Pipeline of one Project (spec §2.3, "Project Pipelines"): an office-wide base Pipeline and the
 * Stage changes the Project makes to it, built whenever it is read.
 */
export interface ProjectPipeline {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly description: string;
  readonly basePipelineId: string;
  readonly stageChanges: readonly StageChange[];
}

/** What the user writes of a Project Pipeline; its id and its Project stay. */
export interface ProjectPipelineEdit {
  readonly name: string;
  readonly description: string;
  readonly basePipelineId: string;
  readonly stageChanges: readonly EditedStageChange[];
}

/**
 * A Proposal of a Project Pipeline (spec §2.3): a new one of the Project (`pipelineId` null), or a
 * change to one, with its fields as they were when drafted (`from`) and as proposed (`to`).
 */
export interface ProposedProjectPipeline {
  readonly projectId: string;
  readonly pipelineId: string | null;
  readonly from: ProjectPipelineEdit | null;
  readonly to: ProjectPipelineEdit;
}

/** A Project Pipeline built from its base Pipeline's current Stages. */
export interface BuiltProjectPipeline {
  readonly projectPipeline: ProjectPipeline;
  readonly basePipeline: { readonly id: string; readonly name: string };
  readonly rows: readonly BuiltStage[];
  readonly stages: readonly Stage[];
  /** Empty when it isn't Broken. */
  readonly broken: readonly BrokenReason[];
}

/** What the Pipelines a Project Pipeline's edit is weighed against hold. */
export interface PipelinesAround {
  readonly officeWide: readonly Pipeline[];
  /** Every Project's Project Pipelines but the one being saved. */
  readonly projectPipelines: readonly ProjectPipeline[];
}

/** A Project Pipeline that a base Pipeline's new Stages would leave Broken, with every reason. */
export interface BrokenProjectPipeline {
  readonly projectPipeline: ProjectPipeline;
  readonly reasons: readonly BrokenReason[];
}

export function builtProjectPipeline(
  projectPipeline: ProjectPipeline,
  base: Pipeline,
): BuiltProjectPipeline {
  const { rows, stages, broken } = buildStages(base, projectPipeline.stageChanges);
  return {
    projectPipeline,
    basePipeline: { id: base.id, name: base.name },
    rows,
    stages,
    broken,
  };
}

/** The built Project Pipeline as a Pipeline a Task copies its Stages from. */
export function asPipeline({ projectPipeline, stages }: BuiltProjectPipeline): Pipeline {
  const { id, name, description } = projectPipeline;
  return { id, name, description, stages };
}

/** The edit built from its base Pipeline; undefined when that isn't an office-wide Pipeline. */
export function builtEdit(
  edit: ProjectPipelineEdit,
  officeWide: readonly Pipeline[],
): BuiltStages | undefined {
  const base = officeWide.find(({ id }) => id === edit.basePipelineId);
  return base && buildStages(base, edit.stageChanges);
}

/**
 * Every reason the Project's edited Pipeline can't be saved, but those needing another module (its
 * Project's commands, engines): a name of its own among the office-wide Pipelines and its Project's,
 * an office-wide base Pipeline, no Change left empty, and built Stages that aren't Broken, as a
 * Project Pipeline's own save never leaves it Broken (spec §2.3).
 */
export function projectPipelineEditProblems(
  edit: ProjectPipelineEdit,
  project: { readonly id: string; readonly name: string },
  around: PipelinesAround,
): StageProblem[] {
  const built = builtEdit(edit, around.officeWide);
  return [
    ...pipelineNameProblems(edit.name, takenByProjectPipeline(project, around)),
    ...basePipelineProblems(edit.basePipelineId, around),
    ...emptyChangeIndexes(edit.stageChanges).map((index) => ({
      text: `Stage change ${index + 1} gives no field: say what changes, or remove it.`,
    })),
    ...(built?.broken ?? []).map(({ stageIndex, text }) =>
      stageIndex === undefined ? { text } : { stageIndex, text },
    ),
  ];
}

/**
 * Why a Proposal of a Project Pipeline can't be applied now, before what its save would be refused
 * for: the Project Pipeline it changes is unknown (or another Project's), it changed since the
 * Proposal was drafted, or nothing would change. `saved` is the one it names, as kept now.
 */
export function proposedProjectPipelineProblems(
  { projectId, pipelineId, from, to }: ProposedProjectPipeline,
  saved: ProjectPipeline | undefined,
): StageProblem[] {
  if (pipelineId === null) return [];
  if (!saved || saved.projectId !== projectId) {
    return [{ text: new UnknownProjectPipeline(pipelineId).message }];
  }
  if (from === null || !sameFieldsAsKept(saved, from)) {
    return [{ text: `${saved.name} changed since this was proposed.` }];
  }
  if (sameFieldsAsKept(from, to)) {
    return [
      {
        text: "Nothing changes: give the Project Pipeline's name, description, base Pipeline or Stage changes as they should be.",
      },
    ];
  }
  return [];
}

/**
 * Fields alike as they are kept, where a field left out and one left undefined are the same; a
 * Stage change's `stageName` is for its words alone, so it doesn't count.
 */
function sameFieldsAsKept(one: ProjectPipelineEdit, other: ProjectPipelineEdit): boolean {
  return isDeepStrictEqual(fieldsAsKept(one), fieldsAsKept(other));
}

function fieldsAsKept(edit: ProjectPipelineEdit): unknown {
  const stageChanges = edit.stageChanges.map(({ stageName: _stageName, ...unnamed }) => unnamed);
  const { name, description, basePipelineId } = edit;
  const fields = {
    name: name.trim(),
    description: description.trim(),
    basePipelineId,
    stageChanges,
  };
  return JSON.parse(JSON.stringify(fields));
}

function basePipelineProblems(basePipelineId: string, around: PipelinesAround): StageProblem[] {
  if (around.officeWide.some(({ id }) => id === basePipelineId)) return [];
  return around.projectPipelines.some(({ id }) => id === basePipelineId)
    ? [{ text: "Its base Pipeline must be an office-wide Pipeline, never a Project Pipeline." }]
    : [{ text: `There is no office-wide Pipeline "${basePipelineId}" to build it from.` }];
}

/** The names a Project Pipeline can't take: the office-wide Pipelines' and its own Project's. */
function takenByProjectPipeline(
  project: { readonly id: string; readonly name: string },
  around: PipelinesAround,
): TakenName[] {
  return [
    ...around.officeWide.map(({ name }) => ({ name, projectName: undefined })),
    ...around.projectPipelines
      .filter((other) => other.projectId === project.id)
      .map(({ name }) => ({ name, projectName: project.name })),
  ];
}

/**
 * A Project Pipeline made from its edit, which `projectPipelineEditProblems` allowed; each Stage
 * change keeps its Stage's name as built now (`built`, from `builtEdit`).
 */
export function addedProjectPipeline(
  id: string,
  projectId: string,
  edit: ProjectPipelineEdit,
  built: BuiltStages,
): { readonly projectPipeline: ProjectPipeline; readonly event: PipelineAdded } {
  return {
    projectPipeline: projectPipelineOf(id, projectId, edit, built),
    event: new PipelineAdded(id),
  };
}

/** A Project Pipeline as the user saved it, its Project kept; `built` as `addedProjectPipeline`'s. */
export function savedProjectPipeline(
  saved: ProjectPipeline,
  edit: ProjectPipelineEdit,
  built: BuiltStages,
): { readonly projectPipeline: ProjectPipeline; readonly event: PipelineSaved } {
  return {
    projectPipeline: projectPipelineOf(saved.id, saved.projectId, edit, built),
    event: new PipelineSaved(saved.id),
  };
}

/**
 * The Project Pipelines built from the base Pipeline that its new Stages would leave Broken, each
 * with every reason (spec §2.3): the warning before an office-wide Pipeline's save, which still
 * goes through.
 */
export function brokenBy(
  base: Pipeline,
  projectPipelines: readonly ProjectPipeline[],
): BrokenProjectPipeline[] {
  return projectPipelines
    .filter(({ basePipelineId }) => basePipelineId === base.id)
    .map((projectPipeline) => ({
      projectPipeline,
      reasons: buildStages(base, projectPipeline.stageChanges).broken,
    }))
    .filter(({ reasons }) => reasons.length > 0);
}

function projectPipelineOf(
  id: string,
  projectId: string,
  { name, description, basePipelineId }: ProjectPipelineEdit,
  built: BuiltStages,
): ProjectPipeline {
  return {
    id,
    projectId,
    name: name.trim(),
    description: description.trim(),
    basePipelineId,
    stageChanges: built.stageChanges,
  };
}

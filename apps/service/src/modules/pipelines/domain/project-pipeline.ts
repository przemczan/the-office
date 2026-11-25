import { asFlow, pipelineOrder } from "./flow.js";
import { pipelineProblem, stageProblems, type Pipeline, type StageProblem } from "./pipeline.js";
import { UnknownProjectPipeline } from "./pipeline-library-refusals.js";
import { PipelineAdded, PipelineSaved } from "./pipeline-library-events.js";
import { pipelineNameProblems, type TakenName } from "./pipeline-names.js";
import { unnamedRoutes } from "./route.js";
import { sameAsKept, type Stage } from "./stage.js";

/** The Pipeline a Project Pipeline was copied from, by name, and when; for its words alone. */
export interface CopiedFrom {
  readonly name: string;
  /** Null for one the move made of a Project Pipeline built on a base Pipeline. */
  readonly at: Date | null;
}

/**
 * A Pipeline of one Project (spec §2.3.5, "Project Pipelines"): its own Stages, routes and places,
 * made as a copy of another Pipeline.
 */
export interface ProjectPipeline {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly description: string;
  readonly stages: readonly Stage[];
  readonly copiedFrom: CopiedFrom;
  /**
   * Why it was Broken when The Office moved it to a flow of its own, each Stage change that didn't
   * apply then each rule its Stages broke; null when it wasn't, or once the user saved it.
   */
  readonly brokenBeforeUpdate: readonly string[] | null;
}

/** What the user writes of a Project Pipeline; its id and its Project stay. */
export interface ProjectPipelineEdit {
  readonly name: string;
  readonly description: string;
  readonly stages: readonly Stage[];
}

/** A new Project Pipeline: a copy of a Pipeline (`copyOf`, by id) under its own name. */
export interface NewProjectPipeline {
  readonly copyOf: string;
  readonly name: string;
  readonly description: string;
}

/**
 * A Proposal of a Project Pipeline: a new one of the Project (`pipelineId` null), copied from
 * `copyOf`, or a change to one, with its fields as they were when drafted (`from`) and as proposed
 * (`to`).
 */
export interface ProposedProjectPipeline {
  readonly projectId: string;
  readonly pipelineId: string | null;
  readonly from: ProjectPipelineEdit | null;
  readonly to: ProjectPipelineEdit;
}

/** What the Pipelines a Project Pipeline's edit is weighed against hold. */
export interface PipelinesAround {
  readonly officeWide: readonly Pipeline[];
  /** Every Project's Project Pipelines but the one being saved. */
  readonly projectPipelines: readonly ProjectPipeline[];
}

/** The Project Pipeline as a Pipeline a Task copies its Stages from. */
export function asPipeline({ id, name, description, stages }: ProjectPipeline): Pipeline {
  return { id, name, description, stages };
}

/**
 * Every reason the Project's edited Pipeline can't be saved, but those needing another module (its
 * Project's commands, engines): the library's rules (spec §2.3.5), a name of its own among the
 * office-wide Pipelines and its Project's, and Stages that can run.
 */
export function projectPipelineEditProblems(
  edit: ProjectPipelineEdit,
  project: { readonly id: string; readonly name: string },
  around: PipelinesAround,
): StageProblem[] {
  return [
    ...projectPipelineNameProblems(edit.name, project, around),
    ...stageProblems(edit.stages),
  ];
}

/** Why the Project Pipeline can't take the name: among the office-wide Pipelines and its Project's. */
export function projectPipelineNameProblems(
  name: string,
  project: { readonly id: string; readonly name: string },
  around: PipelinesAround,
): StageProblem[] {
  return pipelineNameProblems(name, takenByProjectPipeline(project, around));
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
    return [pipelineProblem(new UnknownProjectPipeline(pipelineId).message)];
  }
  if (from === null || !sameFieldsAsKept(saved, from)) {
    return [pipelineProblem(`${saved.name} changed since this was proposed.`)];
  }
  if (sameFieldsAsKept(from, to)) {
    return [
      pipelineProblem(
        "Nothing changes: give the Project Pipeline's name, description or Stages as they should be, all of them.",
      ),
    ];
  }
  return [];
}

/**
 * Fields alike as they are kept, the Stages compared as flows in order; the Stages' names in routes
 * are for their words alone, so they don't count.
 */
function sameFieldsAsKept(one: ProjectPipelineEdit, other: ProjectPipelineEdit): boolean {
  return (
    one.name.trim() === other.name.trim() &&
    one.description.trim() === other.description.trim() &&
    sameAsKept(comparedFlow(one.stages), comparedFlow(other.stages))
  );
}

function comparedFlow(stages: readonly Stage[]): Stage[] {
  return pipelineOrder(asFlow(stages)).map((stage) => ({
    ...stage,
    routes: unnamedRoutes(stage.routes),
  }));
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
 * A Project Pipeline copied from `source`'s Stages as they are, under the name its edit gives, which
 * `projectPipelineNameProblems` allowed; `stages`, when given, are a Proposal's in their place.
 */
export function copiedProjectPipeline(
  id: string,
  projectId: string,
  { name, description }: Omit<NewProjectPipeline, "copyOf">,
  source: Pipeline,
  at: Date,
  stages: readonly Stage[] = source.stages,
): { readonly projectPipeline: ProjectPipeline; readonly event: PipelineAdded } {
  return {
    projectPipeline: {
      id,
      projectId,
      name: name.trim(),
      description: description.trim(),
      stages: flowInOrder(stages),
      copiedFrom: { name: source.name, at },
      brokenBeforeUpdate: null,
    },
    event: new PipelineAdded(id),
  };
}

/**
 * A Project Pipeline as the user saved it, which `projectPipelineEditProblems` allowed: its Project
 * and where it was copied from stay, and a save, even unchanged, ends its Broken before the update.
 * A save the user made elsewhere (`keepsBroken`, a template's edit applied) keeps it, as only their
 * save in its editor ends it.
 */
export function savedProjectPipeline(
  saved: ProjectPipeline,
  { name, description, stages }: ProjectPipelineEdit,
  { keepsBroken = false }: { readonly keepsBroken?: boolean } = {},
): { readonly projectPipeline: ProjectPipeline; readonly event: PipelineSaved } {
  return {
    projectPipeline: {
      ...saved,
      name: name.trim(),
      description: description.trim(),
      stages: flowInOrder(stages),
      brokenBeforeUpdate: keepsBroken ? saved.brokenBeforeUpdate : null,
    },
    event: new PipelineSaved(saved.id),
  };
}

function flowInOrder(stages: readonly Stage[]): Stage[] {
  return pipelineOrder(asFlow(stages));
}

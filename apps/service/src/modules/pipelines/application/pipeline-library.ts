import { Injectable } from "@nestjs/common";
import type { Pipeline } from "../domain/pipeline.js";
import {
  asPipeline,
  builtProjectPipeline,
  type BuiltProjectPipeline,
  type ProjectPipeline,
} from "../domain/project-pipeline.js";
import type { BrokenReason } from "../domain/stage-change.js";
import {
  agentStageWorkers,
  commandKeysNamedBy,
  mergedWorkers,
  NO_STAGE_WORKERS,
  type StageWorkers,
} from "../domain/stage.js";
import { PipelineRepository } from "../ports/pipeline-repository.js";
import { ProjectPipelineRepository } from "../ports/project-pipeline-repository.js";

/**
 * A Pipeline's name, the Project commands its Stages run, by key, and whether it has a Gate; for a
 * Project Pipeline, its Project and why it is Broken, its built Stages counted.
 */
export interface PipelineCommands {
  readonly name: string;
  readonly keys: readonly string[];
  readonly hasGate: boolean;
  /** The Project whose Project Pipeline it is; undefined for an office-wide one. */
  readonly projectId?: string;
  /** Each reason it is Broken, in the UI's words; empty when it isn't. */
  readonly broken: readonly string[];
}

/**
 * A Pipeline as Work reads it to plan and start a Task: an office-wide one, or a Project Pipeline
 * built, with its Project, its base Pipeline and why it is Broken.
 */
export interface ReadPipeline extends Pipeline {
  /** The Project whose Project Pipeline it is; undefined for an office-wide one. */
  readonly projectId?: string;
  readonly basePipeline?: { readonly id: string; readonly name: string };
  /** Each reason it is Broken, in the UI's words; empty when it isn't. */
  readonly broken: readonly string[];
}

/**
 * The Pipeline a Task of a Project starts on: an office-wide one or a Project Pipeline of that
 * Project, built; a Broken one with every reason; or unknown, as another Project's is.
 */
export type PipelineForTask =
  | { readonly kind: "found"; readonly pipeline: Pipeline }
  | { readonly kind: "broken"; readonly name: string; readonly reasons: readonly BrokenReason[] }
  | { readonly kind: "unknown" };

/** How many Project Pipelines of a Project are built from an office-wide Pipeline, and how many are Broken. */
export interface BuiltOnBy {
  readonly projectId: string;
  readonly projectPipelines: number;
  readonly broken: number;
}

/**
 * The office-wide library of Pipelines and, beside it, the Project Pipelines, as other modules read
 * them; each Project Pipeline is built from its base Pipeline's current Stages on every read. The
 * library editor in `PipelineLibraryEditor` changes them.
 */
@Injectable()
export class PipelineLibrary {
  constructor(
    private readonly repository: PipelineRepository,
    private readonly projectPipelineRepository: ProjectPipelineRepository,
  ) {}

  /** The office-wide Pipelines only. */
  async list(): Promise<readonly Pipeline[]> {
    return this.repository.list();
  }

  /** The office-wide Pipelines, then every Project's Project Pipelines, each built. */
  async every(): Promise<readonly ReadPipeline[]> {
    const [officeWide, projectPipelines] = await Promise.all([
      this.list(),
      this.projectPipelines(),
    ]);
    return [
      ...officeWide.map((pipeline) => ({ ...pipeline, broken: [] })),
      ...projectPipelines.map(readOf),
    ];
  }

  /** An office-wide Pipeline; never a Project Pipeline. */
  async find(id: string): Promise<Pipeline | undefined> {
    return this.repository.find(id);
  }

  /** Whether the office-wide library has the Pipeline. */
  async has(id: string): Promise<boolean> {
    return (await this.find(id)) !== undefined;
  }

  /**
   * An office-wide Pipeline, or a Project Pipeline of any Project, built: whoever reads it weighs
   * whose it is, so a refusal can name the Project. Undefined for an id neither table has.
   */
  async read(id: string): Promise<ReadPipeline | undefined> {
    const officeWide = await this.find(id);
    if (officeWide) return { ...officeWide, broken: [] };
    const projectPipeline = await this.projectPipeline(id);
    return projectPipeline && readOf(projectPipeline);
  }

  /** The Project's own Pipelines, each built, then the office-wide ones. */
  async listFor(projectId: string): Promise<readonly ReadPipeline[]> {
    const [own, officeWide] = await Promise.all([this.projectPipelines(projectId), this.list()]);
    return [...own.map(readOf), ...officeWide.map((pipeline) => ({ ...pipeline, broken: [] }))];
  }

  /**
   * A Pipeline's name and the Project commands, by key, its Stages run (`commandKeysNamedBy`), a
   * Project Pipeline's built Stages counted, with its Project and why it is Broken (`read`).
   */
  async commandsNamedBy(id: string): Promise<PipelineCommands | undefined> {
    const pipeline = await this.read(id);
    if (!pipeline) return undefined;
    const { name, stages, projectId, broken } = pipeline;
    return {
      name,
      keys: commandKeysNamedBy(stages),
      hasGate: stages.some(({ kind }) => kind === "gate"),
      ...(projectId === undefined ? {} : { projectId }),
      broken,
    };
  }

  /** The Roles and the duties the office-wide Pipelines' Agent Stages name, each once. */
  async rolesNamed(): Promise<StageWorkers> {
    return agentStageWorkers((await this.list()).flatMap((pipeline) => pipeline.stages));
  }

  /** The Project's Project Pipelines, or every Project's, each built. */
  async projectPipelines(projectId?: string): Promise<readonly BuiltProjectPipeline[]> {
    const [library, projectPipelines] = await Promise.all([
      this.list(),
      projectId === undefined
        ? this.projectPipelineRepository.list()
        : this.projectPipelineRepository.listOf(projectId),
    ]);
    return projectPipelines.map((projectPipeline) => built(projectPipeline, library));
  }

  async projectPipeline(id: string): Promise<BuiltProjectPipeline | undefined> {
    const projectPipeline = await this.projectPipelineRepository.find(id);
    return projectPipeline && built(projectPipeline, await this.list());
  }

  /** The Pipeline a Task of the Project would start on (`PipelineForTask`). */
  async forTask(pipelineId: string, projectId: string): Promise<PipelineForTask> {
    const officeWide = await this.find(pipelineId);
    if (officeWide) return { kind: "found", pipeline: officeWide };
    const projectPipeline = await this.projectPipeline(pipelineId);
    if (projectPipeline?.projectPipeline.projectId !== projectId) return { kind: "unknown" };
    return projectPipeline.broken.length > 0
      ? {
          kind: "broken",
          name: projectPipeline.projectPipeline.name,
          reasons: projectPipeline.broken,
        }
      : { kind: "found", pipeline: asPipeline(projectPipeline) };
  }

  /** The Roles and the duties each Project's Project Pipelines' built Stages name, by Project. */
  async rolesNamedByProject(): Promise<ReadonlyMap<string, StageWorkers>> {
    const byProject = new Map<string, StageWorkers>();
    for (const { projectPipeline, stages } of await this.projectPipelines()) {
      const { projectId } = projectPipeline;
      byProject.set(
        projectId,
        mergedWorkers(byProject.get(projectId) ?? NO_STAGE_WORKERS, agentStageWorkers(stages)),
      );
    }
    return byProject;
  }

  /** For each office-wide Pipeline by its id, the Projects whose Project Pipelines are built from it. */
  async builtOnBy(): Promise<ReadonlyMap<string, readonly BuiltOnBy[]>> {
    const counts = new Map<string, Map<string, BuiltOnBy>>();
    for (const { projectPipeline, broken } of await this.projectPipelines()) {
      const { basePipelineId, projectId } = projectPipeline;
      const byProject = counts.get(basePipelineId) ?? new Map<string, BuiltOnBy>();
      const count = byProject.get(projectId) ?? { projectId, projectPipelines: 0, broken: 0 };
      byProject.set(projectId, {
        projectId,
        projectPipelines: count.projectPipelines + 1,
        broken: count.broken + (broken.length > 0 ? 1 : 0),
      });
      counts.set(basePipelineId, byProject);
    }
    return new Map(
      [...counts].map(([pipelineId, byProject]) => [pipelineId, [...byProject.values()]]),
    );
  }
}

function readOf(projectPipeline: BuiltProjectPipeline): ReadPipeline {
  return {
    ...asPipeline(projectPipeline),
    projectId: projectPipeline.projectPipeline.projectId,
    basePipeline: projectPipeline.basePipeline,
    broken: projectPipeline.broken.map(({ text }) => text),
  };
}

/** The foreign key keeps every base Pipeline while one is built from it. */
function built(
  projectPipeline: ProjectPipeline,
  library: readonly Pipeline[],
): BuiltProjectPipeline {
  const base = library.find(({ id }) => id === projectPipeline.basePipelineId);
  if (!base) {
    throw new Error(
      `Project Pipeline ${projectPipeline.id} is built from "${projectPipeline.basePipelineId}", which the library lacks.`,
    );
  }
  return builtProjectPipeline(projectPipeline, base);
}

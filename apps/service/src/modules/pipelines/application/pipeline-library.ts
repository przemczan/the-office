import { Injectable } from "@nestjs/common";
import type { Pipeline } from "../domain/pipeline.js";
import { asPipeline, type CopiedFrom, type ProjectPipeline } from "../domain/project-pipeline.js";
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
 * Project Pipeline, its Project and why it was Broken before The Office updated.
 */
export interface PipelineCommands {
  readonly name: string;
  readonly keys: readonly string[];
  readonly hasGate: boolean;
  /** The Project whose Project Pipeline it is; undefined for an office-wide one. */
  readonly projectId?: string;
  /** Why it was Broken before The Office updated, in the UI's words; empty when it wasn't. */
  readonly broken: readonly string[];
}

/**
 * A Pipeline as Work reads it to plan and start a Task: an office-wide one, or a Project Pipeline
 * with its Project, where it was copied from, and why it was Broken before The Office updated,
 * which keeps it from being chosen until the user saves it.
 */
export interface ReadPipeline extends Pipeline {
  /** The Project whose Project Pipeline it is; undefined for an office-wide one. */
  readonly projectId?: string;
  readonly copiedFrom?: CopiedFrom;
  /** Why it was Broken before The Office updated, in the UI's words; empty when it wasn't. */
  readonly broken: readonly string[];
}

/**
 * The Pipeline a Task of a Project starts on: an office-wide one or a Project Pipeline of that
 * Project; one Broken before The Office updated, with every reason; or unknown, as another
 * Project's is.
 */
export type PipelineForTask =
  | { readonly kind: "found"; readonly pipeline: Pipeline }
  | { readonly kind: "broken"; readonly name: string; readonly reasons: readonly string[] }
  | { readonly kind: "unknown" };

/**
 * The office-wide library of Pipelines and, beside it, the Project Pipelines, as other modules read
 * them. The library editor in `PipelineLibraryEditor` changes them.
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

  /** The office-wide Pipelines, then every Project's Project Pipelines. */
  async every(): Promise<readonly ReadPipeline[]> {
    const projectPipelines = await this.projectPipelines();
    const officeWide = await this.list();
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
   * An office-wide Pipeline, or a Project Pipeline of any Project: whoever reads it weighs
   * whose it is, so a refusal can name the Project. Undefined for an id neither table has.
   */
  async read(id: string): Promise<ReadPipeline | undefined> {
    const officeWide = await this.find(id);
    if (officeWide) return { ...officeWide, broken: [] };
    const projectPipeline = await this.projectPipeline(id);
    return projectPipeline && readOf(projectPipeline);
  }

  /** The Project's own Pipelines, then the office-wide ones. */
  async listFor(projectId: string): Promise<readonly ReadPipeline[]> {
    const own = await this.projectPipelines(projectId);
    const officeWide = await this.list();
    return [...own.map(readOf), ...officeWide.map((pipeline) => ({ ...pipeline, broken: [] }))];
  }

  /**
   * A Pipeline's name and the Project commands, by key, its Stages run (`commandKeysNamedBy`), a
   * Project Pipeline's with its Project and why it was Broken (`read`).
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

  /** The Project's Project Pipelines, or every Project's. */
  async projectPipelines(projectId?: string): Promise<readonly ProjectPipeline[]> {
    return projectId === undefined
      ? this.projectPipelineRepository.list()
      : this.projectPipelineRepository.listOf(projectId);
  }

  async projectPipeline(id: string): Promise<ProjectPipeline | undefined> {
    return this.projectPipelineRepository.find(id);
  }

  /** The Pipeline a Task of the Project would start on (`PipelineForTask`). */
  async forTask(pipelineId: string, projectId: string): Promise<PipelineForTask> {
    const officeWide = await this.find(pipelineId);
    if (officeWide) return { kind: "found", pipeline: officeWide };
    const projectPipeline = await this.projectPipeline(pipelineId);
    if (projectPipeline?.projectId !== projectId) return { kind: "unknown" };
    return projectPipeline.brokenBeforeUpdate
      ? { kind: "broken", name: projectPipeline.name, reasons: projectPipeline.brokenBeforeUpdate }
      : { kind: "found", pipeline: asPipeline(projectPipeline) };
  }

  /** The Roles and the duties each Project's Project Pipelines' Stages name, by Project. */
  async rolesNamedByProject(): Promise<ReadonlyMap<string, StageWorkers>> {
    const byProject = new Map<string, StageWorkers>();
    for (const { projectId, stages } of await this.projectPipelines()) {
      byProject.set(
        projectId,
        mergedWorkers(byProject.get(projectId) ?? NO_STAGE_WORKERS, agentStageWorkers(stages)),
      );
    }
    return byProject;
  }
}

function readOf(projectPipeline: ProjectPipeline): ReadPipeline {
  return {
    ...asPipeline(projectPipeline),
    projectId: projectPipeline.projectId,
    copiedFrom: projectPipeline.copiedFrom,
    broken: projectPipeline.brokenBeforeUpdate ?? [],
  };
}

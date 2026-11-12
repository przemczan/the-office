import { Injectable } from "@nestjs/common";
import type { Pipeline } from "../domain/pipeline.js";
import {
  asPipeline,
  builtProjectPipeline,
  type BuiltProjectPipeline,
  type ProjectPipeline,
} from "../domain/project-pipeline.js";
import type { BrokenReason } from "../domain/stage-change.js";
import { agentStageRoles, commandKeysNamedBy } from "../domain/stage.js";
import { PipelineRepository } from "../ports/pipeline-repository.js";
import { ProjectPipelineRepository } from "../ports/project-pipeline-repository.js";

/** A library Pipeline's name, the Project commands its Stages run, by key, and whether it has a Gate. */
export interface PipelineCommands {
  readonly name: string;
  readonly keys: readonly string[];
  readonly hasGate: boolean;
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

  /** An office-wide Pipeline; never a Project Pipeline. */
  async find(id: string): Promise<Pipeline | undefined> {
    return this.repository.find(id);
  }

  /** Whether the office-wide library has the Pipeline. */
  async has(id: string): Promise<boolean> {
    return (await this.find(id)) !== undefined;
  }

  /**
   * An office-wide Pipeline's name and the Project commands, by key, its Stages run
   * (`commandKeysNamedBy`); undefined for a Pipeline the office-wide library lacks.
   */
  async commandsNamedBy(id: string): Promise<PipelineCommands | undefined> {
    const pipeline = await this.find(id);
    return (
      pipeline && {
        name: pipeline.name,
        keys: commandKeysNamedBy(pipeline.stages),
        hasGate: pipeline.stages.some(({ kind }) => kind === "gate"),
      }
    );
  }

  /** The Roles the office-wide Pipelines' Agent Stages name, each once. */
  async rolesNamed(): Promise<ReadonlySet<string>> {
    return agentStageRoles((await this.list()).flatMap((pipeline) => pipeline.stages));
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

  /** The Roles each Project's Project Pipelines' built Stages name, by Project. */
  async rolesNamedByProject(): Promise<ReadonlyMap<string, ReadonlySet<string>>> {
    const byProject = new Map<string, Set<string>>();
    for (const { projectPipeline, stages } of await this.projectPipelines()) {
      const roles = byProject.get(projectPipeline.projectId) ?? new Set<string>();
      for (const role of agentStageRoles(stages)) roles.add(role);
      byProject.set(projectPipeline.projectId, roles);
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

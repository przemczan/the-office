import { Injectable } from "@nestjs/common";
import type { Pipeline } from "../domain/pipeline.js";
import { PipelineRepository } from "../ports/pipeline-repository.js";

/**
 * The Office-wide library of Pipelines, as other modules read it. The library editor in
 * `PipelineLibraryEditor` changes it.
 */
@Injectable()
export class PipelineLibrary {
  constructor(private readonly repository: PipelineRepository) {}

  async list(): Promise<readonly Pipeline[]> {
    return this.repository.list();
  }

  async find(id: string): Promise<Pipeline | undefined> {
    return this.repository.find(id);
  }

  async has(id: string): Promise<boolean> {
    return (await this.find(id)) !== undefined;
  }

  /** The Roles the library's Agent Stages name, each once. */
  async rolesNamed(): Promise<ReadonlySet<string>> {
    const stages = (await this.list()).flatMap((pipeline) => pipeline.stages);
    return new Set(stages.flatMap((stage) => (stage.kind === "agent" ? [stage.role] : [])));
  }
}

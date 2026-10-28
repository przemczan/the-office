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
}

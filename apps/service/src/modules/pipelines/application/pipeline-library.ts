import { Injectable } from "@nestjs/common";
import { builtInPipelines } from "../domain/built-in-pipelines.js";
import type { Pipeline } from "../domain/pipeline.js";

/**
 * The Office-wide library of Pipelines. In tier 1 it holds the built-ins only; the library editor
 * of tier 2 stores the rest behind this same service.
 */
@Injectable()
export class PipelineLibrary {
  async list(): Promise<readonly Pipeline[]> {
    return builtInPipelines;
  }

  async find(id: string): Promise<Pipeline | undefined> {
    return builtInPipelines.find((pipeline) => pipeline.id === id);
  }

  async has(id: string): Promise<boolean> {
    return (await this.find(id)) !== undefined;
  }
}

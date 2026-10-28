import type { Pipeline } from "../domain/pipeline.js";

/** The library's Pipelines, stored by The Office; the built-ins are seeded once by migration. */
export abstract class PipelineRepository {
  /** In the library's order: the built-ins first, then the others as they were made. */
  abstract list(): Promise<readonly Pipeline[]>;

  abstract find(id: string): Promise<Pipeline | undefined>;

  abstract add(pipeline: Pipeline): Promise<void>;

  /** Replaces the stored Pipeline with this id. */
  abstract save(pipeline: Pipeline): Promise<void>;

  abstract remove(id: string): Promise<void>;
}

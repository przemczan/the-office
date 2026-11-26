import { Inject, Injectable } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { forgettingReads, readKey, readOnce } from "../../../../platform/database/read-scope.js";
import { asFlow, withPlacesForThePreviousRelease } from "../../domain/flow.js";
import type { Pipeline } from "../../domain/pipeline.js";
import type { StagePosition } from "../../domain/route.js";
import { PipelineRepository } from "../../ports/pipeline-repository.js";
import { pipelines } from "./pipelines.schema.js";

type Row = Omit<Pipeline, "endPosition"> & { readonly endPosition: StagePosition | null };

const PIPELINE_COLUMNS = {
  id: pipelines.id,
  name: pipelines.name,
  description: pipelines.description,
  stages: pipelines.stages,
  endPosition: pipelines.endPosition,
};

@Injectable()
export class PostgresPipelineRepository extends PipelineRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  list(): Promise<readonly Pipeline[]> {
    return readOnce(readKey("pipelines.list"), async () => {
      const rows = await this.database
        .select(PIPELINE_COLUMNS)
        .from(pipelines)
        .orderBy(asc(pipelines.position));
      return rows.map(pipelineOf);
    });
  }

  find(id: string): Promise<Pipeline | undefined> {
    return readOnce(readKey("pipelines.find", id), async () => {
      const [row] = await this.database
        .select(PIPELINE_COLUMNS)
        .from(pipelines)
        .where(eq(pipelines.id, id));
      return row && pipelineOf(row);
    });
  }

  async add(pipeline: Pipeline): Promise<void> {
    await forgettingReads(() => this.database.insert(pipelines).values(rowOf(pipeline)));
  }

  async save(pipeline: Pipeline): Promise<void> {
    return forgettingReads(async () => {
      const { id, ...fields } = rowOf(pipeline);
      await this.database.update(pipelines).set(fields).where(eq(pipelines.id, id));
    });
  }

  async remove(id: string): Promise<void> {
    await forgettingReads(() => this.database.delete(pipelines).where(eq(pipelines.id, id)));
  }
}

/**
 * A row's Pipeline, its Stages a flow, each with its position, even when a rolled-back release wrote
 * them as a list or with places alone.
 */
function pipelineOf({ endPosition, ...row }: Row): Pipeline {
  return { ...row, stages: asFlow(row.stages), ...(endPosition && { endPosition }) };
}

/**
 * The row of `pipeline`, its Stages in the Pipeline's order with the places the previous release
 * reads it from.
 */
function rowOf({ id, name, description, stages, endPosition }: Pipeline) {
  return {
    id,
    name,
    description,
    stages: withPlacesForThePreviousRelease(asFlow(stages)),
    endPosition: endPosition ?? null,
  };
}

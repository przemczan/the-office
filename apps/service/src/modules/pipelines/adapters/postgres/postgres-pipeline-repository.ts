import { Inject, Injectable } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { asFlow, pipelineOrder } from "../../domain/flow.js";
import type { Pipeline } from "../../domain/pipeline.js";
import { PipelineRepository } from "../../ports/pipeline-repository.js";
import { pipelines } from "./pipelines.schema.js";

const PIPELINE_COLUMNS = {
  id: pipelines.id,
  name: pipelines.name,
  description: pipelines.description,
  stages: pipelines.stages,
};

@Injectable()
export class PostgresPipelineRepository extends PipelineRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async list(): Promise<readonly Pipeline[]> {
    const rows = await this.database
      .select(PIPELINE_COLUMNS)
      .from(pipelines)
      .orderBy(asc(pipelines.position));
    return rows.map(pipelineOf);
  }

  async find(id: string): Promise<Pipeline | undefined> {
    const [row] = await this.database
      .select(PIPELINE_COLUMNS)
      .from(pipelines)
      .where(eq(pipelines.id, id));
    return row && pipelineOf(row);
  }

  async add(pipeline: Pipeline): Promise<void> {
    await this.database.insert(pipelines).values(rowOf(pipeline));
  }

  async save(pipeline: Pipeline): Promise<void> {
    const { id, ...fields } = rowOf(pipeline);
    await this.database.update(pipelines).set(fields).where(eq(pipelines.id, id));
  }

  async remove(id: string): Promise<void> {
    await this.database.delete(pipelines).where(eq(pipelines.id, id));
  }
}

/** A row's Pipeline, its Stages a flow even when a rolled-back release wrote them as a list. */
function pipelineOf(row: Pipeline): Pipeline {
  return { ...row, stages: asFlow(row.stages) };
}

/** The row of `pipeline`, its Stages in the Pipeline's order, as the previous release reads them. */
function rowOf({ id, name, description, stages }: Pipeline) {
  return { id, name, description, stages: pipelineOrder(asFlow(stages)) };
}

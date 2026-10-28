import { Inject, Injectable } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
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
    return this.database.select(PIPELINE_COLUMNS).from(pipelines).orderBy(asc(pipelines.position));
  }

  async find(id: string): Promise<Pipeline | undefined> {
    const [row] = await this.database
      .select(PIPELINE_COLUMNS)
      .from(pipelines)
      .where(eq(pipelines.id, id));
    return row;
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

function rowOf({ id, name, description, stages }: Pipeline) {
  return { id, name, description, stages: [...stages] };
}

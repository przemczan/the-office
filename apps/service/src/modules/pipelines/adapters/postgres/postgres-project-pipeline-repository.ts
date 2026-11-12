import { Inject, Injectable } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { ProjectPipeline } from "../../domain/project-pipeline.js";
import { ProjectPipelineRepository } from "../../ports/project-pipeline-repository.js";
import { projectPipelines } from "./project-pipelines.schema.js";

const PROJECT_PIPELINE_COLUMNS = {
  id: projectPipelines.id,
  projectId: projectPipelines.projectId,
  name: projectPipelines.name,
  description: projectPipelines.description,
  basePipelineId: projectPipelines.basePipelineId,
  stageChanges: projectPipelines.stageChanges,
};

@Injectable()
export class PostgresProjectPipelineRepository extends ProjectPipelineRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async list(): Promise<readonly ProjectPipeline[]> {
    return this.database
      .select(PROJECT_PIPELINE_COLUMNS)
      .from(projectPipelines)
      .orderBy(asc(projectPipelines.position));
  }

  async listOf(projectId: string): Promise<readonly ProjectPipeline[]> {
    return this.database
      .select(PROJECT_PIPELINE_COLUMNS)
      .from(projectPipelines)
      .where(eq(projectPipelines.projectId, projectId))
      .orderBy(asc(projectPipelines.position));
  }

  async find(id: string): Promise<ProjectPipeline | undefined> {
    const [row] = await this.database
      .select(PROJECT_PIPELINE_COLUMNS)
      .from(projectPipelines)
      .where(eq(projectPipelines.id, id));
    return row;
  }

  async builtFrom(basePipelineId: string): Promise<readonly ProjectPipeline[]> {
    return this.database
      .select(PROJECT_PIPELINE_COLUMNS)
      .from(projectPipelines)
      .where(eq(projectPipelines.basePipelineId, basePipelineId))
      .orderBy(asc(projectPipelines.position));
  }

  async add(projectPipeline: ProjectPipeline): Promise<void> {
    await this.database.insert(projectPipelines).values(rowOf(projectPipeline));
  }

  async save(projectPipeline: ProjectPipeline): Promise<void> {
    const { id, name, description, basePipelineId, stageChanges } = rowOf(projectPipeline);
    await this.database
      .update(projectPipelines)
      .set({ name, description, basePipelineId, stageChanges })
      .where(eq(projectPipelines.id, id));
  }

  async remove(id: string): Promise<void> {
    await this.database.delete(projectPipelines).where(eq(projectPipelines.id, id));
  }
}

function rowOf(projectPipeline: ProjectPipeline) {
  return { ...projectPipeline, stageChanges: [...projectPipeline.stageChanges] };
}

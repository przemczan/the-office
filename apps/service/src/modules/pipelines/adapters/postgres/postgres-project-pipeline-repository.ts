import { Inject, Injectable } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { forgettingReads, readKey, readOnce } from "../../../../platform/database/read-scope.js";
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

  list(): Promise<readonly ProjectPipeline[]> {
    return readOnce(readKey("projectPipelines.list"), async () => {
      return this.database
        .select(PROJECT_PIPELINE_COLUMNS)
        .from(projectPipelines)
        .orderBy(asc(projectPipelines.position));
    });
  }

  listOf(projectId: string): Promise<readonly ProjectPipeline[]> {
    return readOnce(readKey("projectPipelines.listOf", projectId), async () => {
      return this.database
        .select(PROJECT_PIPELINE_COLUMNS)
        .from(projectPipelines)
        .where(eq(projectPipelines.projectId, projectId))
        .orderBy(asc(projectPipelines.position));
    });
  }

  find(id: string): Promise<ProjectPipeline | undefined> {
    return readOnce(readKey("projectPipelines.find", id), async () => {
      const [row] = await this.database
        .select(PROJECT_PIPELINE_COLUMNS)
        .from(projectPipelines)
        .where(eq(projectPipelines.id, id));
      return row;
    });
  }

  builtFrom(basePipelineId: string): Promise<readonly ProjectPipeline[]> {
    return readOnce(readKey("projectPipelines.builtFrom", basePipelineId), async () => {
      return this.database
        .select(PROJECT_PIPELINE_COLUMNS)
        .from(projectPipelines)
        .where(eq(projectPipelines.basePipelineId, basePipelineId))
        .orderBy(asc(projectPipelines.position));
    });
  }

  async add(projectPipeline: ProjectPipeline): Promise<void> {
    await forgettingReads(() =>
      this.database.insert(projectPipelines).values(rowOf(projectPipeline)),
    );
  }

  async save(projectPipeline: ProjectPipeline): Promise<void> {
    return forgettingReads(async () => {
      const { id, name, description, basePipelineId, stageChanges } = rowOf(projectPipeline);
      await this.database
        .update(projectPipelines)
        .set({ name, description, basePipelineId, stageChanges })
        .where(eq(projectPipelines.id, id));
    });
  }

  async remove(id: string): Promise<void> {
    await forgettingReads(() =>
      this.database.delete(projectPipelines).where(eq(projectPipelines.id, id)),
    );
  }
}

function rowOf(projectPipeline: ProjectPipeline) {
  return { ...projectPipeline, stageChanges: [...projectPipeline.stageChanges] };
}

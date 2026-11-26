import { Inject, Injectable } from "@nestjs/common";
import { asc, eq, type SQL } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { forgettingReads, readKey, readOnce } from "../../../../platform/database/read-scope.js";
import { asFlow, withPlacesForThePreviousRelease } from "../../domain/flow.js";
import type { ProjectPipeline } from "../../domain/project-pipeline.js";
import { ProjectPipelineRepository } from "../../ports/project-pipeline-repository.js";
import { projectPipelines } from "./project-pipelines.schema.js";

type Row = typeof projectPipelines.$inferSelect;

function selectRows(database: Database, where: SQL | undefined) {
  return database
    .select()
    .from(projectPipelines)
    .where(where)
    .orderBy(asc(projectPipelines.position));
}

@Injectable()
export class PostgresProjectPipelineRepository extends ProjectPipelineRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  list(): Promise<readonly ProjectPipeline[]> {
    return readOnce(readKey("projectPipelines.list"), async () => {
      return (await selectRows(this.database, undefined)).map(projectPipelineOf);
    });
  }

  listOf(projectId: string): Promise<readonly ProjectPipeline[]> {
    return readOnce(readKey("projectPipelines.listOf", projectId), async () => {
      const rows = await selectRows(this.database, eq(projectPipelines.projectId, projectId));
      return rows.map(projectPipelineOf);
    });
  }

  find(id: string): Promise<ProjectPipeline | undefined> {
    return readOnce(readKey("projectPipelines.find", id), async () => {
      const [row] = await selectRows(this.database, eq(projectPipelines.id, id));
      return row && projectPipelineOf(row);
    });
  }

  async add(projectPipeline: ProjectPipeline): Promise<void> {
    await forgettingReads(async () => {
      const { id, projectId, name, description } = projectPipeline;
      await this.database
        .insert(projectPipelines)
        .values({ id, projectId, name, description, ...flowColumnsOf(projectPipeline) });
    });
  }

  async save(projectPipeline: ProjectPipeline): Promise<void> {
    await forgettingReads(async () => {
      const { id, name, description } = projectPipeline;
      await this.database
        .update(projectPipelines)
        .set({ name, description, ...flowColumnsOf(projectPipeline) })
        .where(eq(projectPipelines.id, id));
    });
  }

  async remove(id: string): Promise<void> {
    await forgettingReads(() =>
      this.database.delete(projectPipelines).where(eq(projectPipelines.id, id)),
    );
  }
}

function projectPipelineOf(row: Row): ProjectPipeline {
  const { id, projectId, name, description, stages, endPosition, copiedFromName, copiedAt } = row;
  return {
    id,
    projectId,
    name,
    description,
    stages: asFlow(stages),
    ...(endPosition && { endPosition }),
    copiedFrom: { name: copiedFromName ?? "", at: copiedAt },
    brokenBeforeUpdate: row.brokenBeforeUpdate,
  };
}

/** Its Stages in the Pipeline's order, with the places the previous release reads it from. */
function flowColumnsOf({ stages, endPosition, copiedFrom, brokenBeforeUpdate }: ProjectPipeline) {
  return {
    stages: withPlacesForThePreviousRelease(asFlow(stages)),
    endPosition: endPosition ?? null,
    copiedFromName: copiedFrom.name,
    copiedAt: copiedFrom.at,
    brokenBeforeUpdate: brokenBeforeUpdate === null ? null : [...brokenBeforeUpdate],
  };
}

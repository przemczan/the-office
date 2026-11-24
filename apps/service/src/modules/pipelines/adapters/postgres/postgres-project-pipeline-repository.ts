import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, isNull, type SQL } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { forgettingReads, readKey, readOnce } from "../../../../platform/database/read-scope.js";
import { asFlow, pipelineOrder } from "../../domain/flow.js";
import {
  movedProjectPipeline,
  type LegacyProjectPipeline,
  type ProjectPipeline,
} from "../../domain/project-pipeline.js";
import { ProjectPipelineRepository } from "../../ports/project-pipeline-repository.js";
import { pipelines } from "./pipelines.schema.js";
import { projectPipelines } from "./project-pipelines.schema.js";

const LEGACY_COLUMNS = {
  id: projectPipelines.id,
  projectId: projectPipelines.projectId,
  name: projectPipelines.name,
  description: projectPipelines.description,
  basePipelineId: projectPipelines.basePipelineId,
  stageChanges: projectPipelines.stageChanges,
};

const ROW_COLUMNS = {
  ...LEGACY_COLUMNS,
  stages: projectPipelines.stages,
  copiedFromName: projectPipelines.copiedFromName,
  copiedAt: projectPipelines.copiedAt,
  brokenBeforeUpdate: projectPipelines.brokenBeforeUpdate,
  /** The base Pipeline, read only for a row not yet moved. */
  base: {
    id: pipelines.id,
    name: pipelines.name,
    description: pipelines.description,
    stages: pipelines.stages,
  },
};

type Row = Awaited<ReturnType<typeof selectRows>>[number];

function selectRows(database: Database, where: SQL | undefined) {
  return database
    .select(ROW_COLUMNS)
    .from(projectPipelines)
    .leftJoin(pipelines, eq(pipelines.id, projectPipelines.basePipelineId))
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

  async add(projectPipeline: ProjectPipeline, copyOf: string): Promise<void> {
    await forgettingReads(async () => {
      const [copied] = await this.database
        .select({ basePipelineId: projectPipelines.basePipelineId })
        .from(projectPipelines)
        .where(eq(projectPipelines.id, copyOf));
      const { id, projectId, name, description } = projectPipeline;
      await this.database.insert(projectPipelines).values({
        id,
        projectId,
        name,
        description,
        basePipelineId: copied?.basePipelineId ?? copyOf,
        stageChanges: [],
        ...flowColumnsOf(projectPipeline),
      });
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

  async rowsToMoveOver(): Promise<readonly LegacyProjectPipeline[]> {
    return this.database
      .select(LEGACY_COLUMNS)
      .from(projectPipelines)
      .where(isNull(projectPipelines.stages))
      .orderBy(asc(projectPipelines.position));
  }

  async moveOver(moved: ProjectPipeline): Promise<void> {
    await forgettingReads(() =>
      this.database
        .update(projectPipelines)
        .set(flowColumnsOf(moved))
        .where(and(eq(projectPipelines.id, moved.id), isNull(projectPipelines.stages))),
    );
  }
}

function projectPipelineOf(row: Row): ProjectPipeline {
  const { base, stages, copiedFromName, copiedAt, brokenBeforeUpdate, ...legacy } = row;
  if (stages === null) {
    return movedProjectPipeline(
      legacy,
      base ? { ...base, stages: asFlow(base.stages) } : undefined,
    );
  }
  const { id, projectId, name, description } = legacy;
  return {
    id,
    projectId,
    name,
    description,
    stages: asFlow(stages),
    copiedFrom: { name: copiedFromName ?? "", at: copiedAt },
    brokenBeforeUpdate,
  };
}

function flowColumnsOf({ stages, copiedFrom, brokenBeforeUpdate }: ProjectPipeline) {
  return {
    stages: pipelineOrder(asFlow(stages)),
    copiedFromName: copiedFrom.name,
    copiedAt: copiedFrom.at,
    brokenBeforeUpdate: brokenBeforeUpdate === null ? null : [...brokenBeforeUpdate],
  };
}

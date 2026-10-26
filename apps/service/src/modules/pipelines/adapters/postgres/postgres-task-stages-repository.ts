import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { TaskStages, TaskTrace } from "../../domain/task-stages.js";
import { TaskStagesRepository } from "../../ports/task-stages-repository.js";
import { taskStages } from "./task-stages.schema.js";

@Injectable()
export class PostgresTaskStagesRepository extends TaskStagesRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async saveNew(given: TaskStages): Promise<boolean> {
    const saved = await this.database
      .insert(taskStages)
      .values({ ...given, stages: [...given.stages] })
      .onConflictDoNothing()
      .returning({ taskId: taskStages.taskId });
    return saved.length > 0;
  }

  async find(taskId: string): Promise<TaskStages | undefined> {
    const [row] = await this.database
      .select()
      .from(taskStages)
      .where(eq(taskStages.taskId, taskId));
    return row && { ...row, trace: row.trace ?? undefined };
  }

  async saveTrace(taskId: string, trace: TaskTrace): Promise<void> {
    await this.database.update(taskStages).set({ trace }).where(eq(taskStages.taskId, taskId));
  }
}

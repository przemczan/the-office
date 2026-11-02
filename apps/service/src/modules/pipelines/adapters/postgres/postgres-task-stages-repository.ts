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

  async save(given: TaskStages): Promise<void> {
    const row = { ...given, stages: [...given.stages], trace: given.trace ?? null };
    await this.database
      .insert(taskStages)
      .values(row)
      .onConflictDoUpdate({ target: taskStages.taskId, set: row });
  }

  async find(taskId: string): Promise<TaskStages | undefined> {
    const [row] = await this.database
      .select()
      .from(taskStages)
      .where(eq(taskStages.taskId, taskId));
    return row && taskStagesOf(row);
  }

  async list(): Promise<readonly TaskStages[]> {
    const rows = await this.database.select().from(taskStages);
    return rows.map(taskStagesOf);
  }

  async saveTrace(taskId: string, trace: TaskTrace): Promise<void> {
    await this.database.update(taskStages).set({ trace }).where(eq(taskStages.taskId, taskId));
  }

  async remove(taskId: string): Promise<void> {
    await this.database.delete(taskStages).where(eq(taskStages.taskId, taskId));
  }
}

function taskStagesOf(row: typeof taskStages.$inferSelect): TaskStages {
  return { ...row, trace: row.trace ?? undefined };
}

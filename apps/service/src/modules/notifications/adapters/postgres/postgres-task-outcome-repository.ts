import { Inject, Injectable } from "@nestjs/common";
import { gt } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { TaskOutcome } from "../../domain/task-outcome.js";
import { TaskOutcomeRepository } from "../../ports/task-outcome-repository.js";
import { taskOutcomes } from "./notifications.schema.js";

@Injectable()
export class PostgresTaskOutcomeRepository extends TaskOutcomeRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async add(outcome: TaskOutcome): Promise<void> {
    await this.database.insert(taskOutcomes).values(outcome);
  }

  async since(at: Date): Promise<readonly TaskOutcome[]> {
    return this.database
      .select({
        taskId: taskOutcomes.taskId,
        outcome: taskOutcomes.outcome,
        occurredAt: taskOutcomes.occurredAt,
      })
      .from(taskOutcomes)
      .where(gt(taskOutcomes.occurredAt, at));
  }
}

import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gt, gte, lt, type SQL } from "drizzle-orm";
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
    await this.database
      .insert(taskOutcomes)
      .values({ ...outcome, stageName: outcome.stageName ?? null });
  }

  async since(at: Date): Promise<readonly TaskOutcome[]> {
    return this.outcomesWhere(gt(taskOutcomes.occurredAt, at));
  }

  async failedBetween(start: Date, end: Date): Promise<readonly TaskOutcome[]> {
    return this.outcomesWhere(
      and(
        eq(taskOutcomes.outcome, "failed"),
        gte(taskOutcomes.occurredAt, start),
        lt(taskOutcomes.occurredAt, end),
      ),
    );
  }

  private async outcomesWhere(condition: SQL | undefined): Promise<readonly TaskOutcome[]> {
    const rows = await this.database
      .select({
        taskId: taskOutcomes.taskId,
        outcome: taskOutcomes.outcome,
        occurredAt: taskOutcomes.occurredAt,
        stageName: taskOutcomes.stageName,
      })
      .from(taskOutcomes)
      .where(condition);
    return rows.map(({ stageName, ...outcome }) => ({
      ...outcome,
      ...(stageName !== null && { stageName }),
    }));
  }
}

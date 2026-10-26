import { Inject, Injectable } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { StageCommandRun } from "../../domain/stage-command-run.js";
import type { StageRun } from "../../domain/stage-run.js";
import { StageRunRepository } from "../../ports/stage-run-repository.js";
import { stageRuns } from "./stage-runs.schema.js";

@Injectable()
export class PostgresStageRunRepository extends StageRunRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async saveNew(run: StageRun): Promise<boolean> {
    const saved = await this.database
      .insert(stageRuns)
      .values(run)
      .onConflictDoNothing({ target: [stageRuns.taskId, stageRuns.number] })
      .returning({ id: stageRuns.id });
    return saved.length > 0;
  }

  async saveThread(runId: string, threadId: string): Promise<void> {
    await this.database.update(stageRuns).set({ threadId }).where(eq(stageRuns.id, runId));
  }

  async saveHeadCommit(runId: string, headCommit: string): Promise<void> {
    await this.database.update(stageRuns).set({ headCommit }).where(eq(stageRuns.id, runId));
  }

  async saveCommandRuns(runId: string, commandRuns: readonly StageCommandRun[]): Promise<void> {
    await this.database.update(stageRuns).set({ commandRuns }).where(eq(stageRuns.id, runId));
  }

  async saveEnded({ id, outcome, endedAt }: StageRun): Promise<void> {
    await this.database.update(stageRuns).set({ outcome, endedAt }).where(eq(stageRuns.id, id));
  }

  async list(taskId: string): Promise<readonly StageRun[]> {
    const rows = await this.database
      .select()
      .from(stageRuns)
      .where(eq(stageRuns.taskId, taskId))
      .orderBy(asc(stageRuns.number));
    return rows.map((row) => ({
      ...row,
      carriedFailure: row.carriedFailure ?? undefined,
      threadId: row.threadId ?? undefined,
      headCommit: row.headCommit ?? undefined,
      outcome: row.outcome ?? undefined,
      endedAt: row.endedAt ?? undefined,
    }));
  }
}

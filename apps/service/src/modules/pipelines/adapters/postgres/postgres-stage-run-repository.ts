import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, isNull } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { StageCommandRun } from "../../domain/stage-command-run.js";
import type {
  GateAction,
  StageRun,
  StageRunDecision,
  StageTokens,
  AskedInterruption,
  UsageWindowReading,
} from "../../domain/stage-run.js";
import {
  StageRunRepository,
  type StageRunThread,
  type UsageWindowsMoment,
} from "../../ports/stage-run-repository.js";
import { stageRuns } from "./stage-runs.schema.js";
import {
  storedUsageWindowReading,
  usageWindowReadingOf,
  type StoredUsageWindowReading,
} from "./stored-usage-windows.js";

@Injectable()
export class PostgresStageRunRepository extends StageRunRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async saveNew(run: StageRun): Promise<boolean> {
    const saved = await this.database
      .insert(stageRuns)
      .values({
        ...run,
        usageWindowsAtStart: storedOrNone(run.usageWindowsAtStart),
        usageWindowsAtEnd: storedOrNone(run.usageWindowsAtEnd),
      })
      .onConflictDoNothing({ target: [stageRuns.taskId, stageRuns.number] })
      .returning({ id: stageRuns.id });
    return saved.length > 0;
  }

  async saveThread(runId: string, thread: StageRunThread): Promise<void> {
    await this.database.update(stageRuns).set(thread).where(eq(stageRuns.id, runId));
  }

  async saveUsageWindows(
    runId: string,
    moment: UsageWindowsMoment,
    reading: UsageWindowReading,
  ): Promise<void> {
    const stored = storedUsageWindowReading(reading);
    await this.database
      .update(stageRuns)
      .set(moment === "start" ? { usageWindowsAtStart: stored } : { usageWindowsAtEnd: stored })
      .where(eq(stageRuns.id, runId));
  }

  async saveHeadCommit(runId: string, headCommit: string): Promise<void> {
    await this.database.update(stageRuns).set({ headCommit }).where(eq(stageRuns.id, runId));
  }

  async saveCommandRuns(runId: string, commandRuns: readonly StageCommandRun[]): Promise<void> {
    await this.database.update(stageRuns).set({ commandRuns }).where(eq(stageRuns.id, runId));
  }

  async saveTokens(runId: string, tokens: StageTokens): Promise<void> {
    await this.database.update(stageRuns).set({ tokens }).where(eq(stageRuns.id, runId));
  }

  async saveDecisions(runId: string, decisions: readonly StageRunDecision[]): Promise<void> {
    await this.database.update(stageRuns).set({ decisions }).where(eq(stageRuns.id, runId));
  }

  async saveHeldBy(runId: string, heldBy: AskedInterruption): Promise<void> {
    await this.database.update(stageRuns).set({ heldBy }).where(eq(stageRuns.id, runId));
  }

  async saveGateAction(runId: string, gateAction: GateAction): Promise<boolean> {
    const saved = await this.database
      .update(stageRuns)
      .set({ gateAction })
      .where(and(eq(stageRuns.id, runId), isNull(stageRuns.gateAction)))
      .returning({ id: stageRuns.id });
    return saved.length > 0;
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
      sentBack: row.sentBack ?? undefined,
      threadId: row.threadId ?? undefined,
      session: row.session ?? undefined,
      engine: row.engine ?? undefined,
      model: row.model ?? undefined,
      usageWindowsAtStart: readingOrNone(row.usageWindowsAtStart),
      usageWindowsAtEnd: readingOrNone(row.usageWindowsAtEnd),
      headCommit: row.headCommit ?? undefined,
      heldBy: row.heldBy ?? undefined,
      gateAction: row.gateAction ?? undefined,
      outcome: row.outcome ?? undefined,
      endedAt: row.endedAt ?? undefined,
    }));
  }
}

function storedOrNone(
  reading: UsageWindowReading | undefined,
): StoredUsageWindowReading | undefined {
  return reading === undefined ? undefined : storedUsageWindowReading(reading);
}

function readingOrNone(stored: StoredUsageWindowReading | null): UsageWindowReading | undefined {
  return stored === null ? undefined : usageWindowReadingOf(stored);
}

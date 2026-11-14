import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, getTableColumns, inArray, isNull } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { StageCommandRunWithOutput } from "../../domain/stage-command-run.js";
import type {
  GateAction,
  PublishedWork,
  StageRun,
  StageRunContext,
  StageRunDecision,
  StageTokens,
  AskedInterruption,
  HoldingUser,
} from "../../domain/stage-run.js";
import { StageRunRepository, type StageRunThread } from "../../ports/stage-run-repository.js";
import { stageRuns } from "./stage-runs.schema.js";

const { commandOutputs: _readOnlyByRun, ...stageRunColumns } = getTableColumns(stageRuns);

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

  async saveThread(runId: string, thread: StageRunThread): Promise<void> {
    await this.database.update(stageRuns).set(thread).where(eq(stageRuns.id, runId));
  }

  async saveHeadCommit(runId: string, headCommit: string): Promise<void> {
    await this.database.update(stageRuns).set({ headCommit }).where(eq(stageRuns.id, runId));
  }

  async saveCommandRuns(
    runId: string,
    commandRuns: readonly StageCommandRunWithOutput[],
  ): Promise<void> {
    await this.database
      .update(stageRuns)
      .set({
        commandRuns: commandRuns.map(({ wholeOutput: _keptApart, ...run }) => run),
        commandOutputs: commandRuns.map(({ wholeOutput }) => wholeOutput),
      })
      .where(eq(stageRuns.id, runId));
  }

  async saveTokens(runId: string, tokens: StageTokens): Promise<void> {
    await this.database.update(stageRuns).set({ tokens }).where(eq(stageRuns.id, runId));
  }

  async saveContext(runId: string, context: StageRunContext): Promise<void> {
    await this.database.update(stageRuns).set({ context }).where(eq(stageRuns.id, runId));
  }

  async saveDecisions(runId: string, decisions: readonly StageRunDecision[]): Promise<void> {
    await this.database.update(stageRuns).set({ decisions }).where(eq(stageRuns.id, runId));
  }

  async savePublished(runId: string, published: PublishedWork): Promise<void> {
    await this.database.update(stageRuns).set({ published }).where(eq(stageRuns.id, runId));
  }

  async saveWaitingSince(runId: string, waitingSince: Date | undefined): Promise<void> {
    await this.database
      .update(stageRuns)
      .set({ waitingSince: waitingSince ?? null })
      .where(eq(stageRuns.id, runId));
  }

  async saveHeldBy(
    runId: string,
    heldBy: AskedInterruption,
    heldByUser: HoldingUser | undefined,
  ): Promise<void> {
    await this.database
      .update(stageRuns)
      .set({ heldBy, heldByUser: heldByUser ?? null })
      .where(eq(stageRuns.id, runId));
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
    await this.database
      .update(stageRuns)
      .set({ outcome, endedAt, waitingSince: null })
      .where(eq(stageRuns.id, id));
  }

  async list(taskId: string): Promise<readonly StageRun[]> {
    const rows = await this.database
      .select(stageRunColumns)
      .from(stageRuns)
      .where(eq(stageRuns.taskId, taskId))
      .orderBy(asc(stageRuns.number));
    return rows.map(stageRunOf);
  }

  async listOfTasks(taskIds: readonly string[]): Promise<readonly StageRun[]> {
    if (taskIds.length === 0) return [];
    const rows = await this.database
      .select(stageRunColumns)
      .from(stageRuns)
      .where(inArray(stageRuns.taskId, [...taskIds]))
      .orderBy(asc(stageRuns.taskId), asc(stageRuns.number));
    return rows.map(stageRunOf);
  }

  async commandOutputs(taskId: string, runId: string): Promise<readonly string[] | undefined> {
    const [row] = await this.database
      .select({ commandRuns: stageRuns.commandRuns, commandOutputs: stageRuns.commandOutputs })
      .from(stageRuns)
      .where(and(eq(stageRuns.taskId, taskId), eq(stageRuns.id, runId)));
    return row?.commandRuns.map(({ output }, index) => row.commandOutputs[index] ?? output);
  }
}

function stageRunOf(row: Omit<typeof stageRuns.$inferSelect, "commandOutputs">): StageRun {
  return {
    ...row,
    carriedFailure: row.carriedFailure ?? undefined,
    sentBack: row.sentBack ?? undefined,
    threadId: row.threadId ?? undefined,
    roleKey: row.roleKey ?? undefined,
    session: row.session ?? undefined,
    engineId: row.engineId ?? undefined,
    engineName: row.engineName ?? undefined,
    model: row.model ?? undefined,
    context: row.context ?? undefined,
    headCommit: row.headCommit ?? undefined,
    heldBy: row.heldBy ?? undefined,
    heldByUser: row.heldByUser ?? undefined,
    gateAction: row.gateAction ?? undefined,
    outcome: row.outcome ?? undefined,
    published: row.published ?? undefined,
    waitingSince: row.waitingSince ?? undefined,
    endedAt: row.endedAt ?? undefined,
  };
}

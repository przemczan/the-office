import { Inject, Injectable } from "@nestjs/common";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  getTableColumns,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  max,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { StageCommandRunWithOutput } from "../../domain/stage-command-run.js";
import type {
  EngineSwitch,
  ChosenRoute,
  PublishedWork,
  StageRun,
  StageRunContext,
  StageRunStandIn,
  StageTokens,
} from "../../domain/stage-run.js";
import type { StageRunChange } from "../../domain/stage-run-changes.js";
import type { StageRunUsage } from "../../domain/usage-history.js";
import {
  StageRunRepository,
  type LeftBranch,
  type RanAgentStageRun,
  type KeptStageRunEngines,
  type StageRunThread,
  type StartedStageRun,
} from "../../ports/stage-run-repository.js";
import { stageRuns } from "./stage-runs.schema.js";
import { taskStages } from "./task-stages.schema.js";

const { commandOutputs: _readOnlyByRun, ...stageRunColumns } = getTableColumns(stageRuns);

@Injectable()
export class PostgresStageRunRepository extends StageRunRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async saveNew({ standInFor, ...run }: StageRun): Promise<boolean> {
    const saved = await this.database
      .insert(stageRuns)
      .values({ ...run, ...standInColumns(standInFor) })
      .onConflictDoNothing({ target: [stageRuns.taskId, stageRuns.number] })
      .returning({ id: stageRuns.id });
    return saved.length > 0;
  }

  async saveThread(runId: string, { standInFor, ...thread }: StageRunThread): Promise<void> {
    await this.database
      .update(stageRuns)
      .set({ ...thread, ...standInColumns(standInFor) })
      .where(eq(stageRuns.id, runId));
  }

  async saveEngineSwitch(
    runId: string,
    engineSwitch: EngineSwitch,
    {
      engineId,
      engineName,
      standInFor,
    }: Pick<StageRunThread, "engineId" | "engineName" | "standInFor">,
  ): Promise<void> {
    await this.database
      .update(stageRuns)
      .set({
        engineId,
        engineName,
        ...standInColumns(standInFor),
        engineSwitches: sql`${stageRuns.engineSwitches} || ${JSON.stringify([engineSwitch])}::jsonb`,
      })
      .where(eq(stageRuns.id, runId));
  }

  async taskOf(runId: string): Promise<string | undefined> {
    const [row] = await this.database
      .select({ taskId: stageRuns.taskId })
      .from(stageRuns)
      .where(eq(stageRuns.id, runId));
    return row?.taskId;
  }

  async saveHeadCommit(runId: string, headCommit: string): Promise<void> {
    await this.database.update(stageRuns).set({ headCommit }).where(eq(stageRuns.id, runId));
  }

  async saveLeftBranch(runId: string, left: LeftBranch): Promise<void> {
    await this.database.update(stageRuns).set(left).where(eq(stageRuns.id, runId));
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

  async addCommandRuns(
    runId: string,
    commandRuns: readonly StageCommandRunWithOutput[],
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select({ commandRuns: stageRuns.commandRuns, commandOutputs: stageRuns.commandOutputs })
        .from(stageRuns)
        .where(eq(stageRuns.id, runId))
        .for("update");
      if (!row) throw new Error(`There is no Stage run ${runId} to add command runs to.`);
      // A run saved before whole outputs were kept has fewer outputs than runs: its own filtered
      // outputs fill the gap, so each output stays at its run's place.
      const outputs = row.commandRuns.map(
        ({ output }, index) => row.commandOutputs[index] ?? output,
      );
      await transaction
        .update(stageRuns)
        .set({
          commandRuns: [
            ...row.commandRuns,
            ...commandRuns.map(({ wholeOutput: _keptApart, ...run }) => run),
          ],
          commandOutputs: [...outputs, ...commandRuns.map(({ wholeOutput }) => wholeOutput)],
        })
        .where(eq(stageRuns.id, runId));
    });
  }

  async saveTokens(runId: string, tokens: StageTokens): Promise<void> {
    await this.database.update(stageRuns).set({ tokens }).where(eq(stageRuns.id, runId));
  }

  async saveContext(runId: string, context: StageRunContext): Promise<void> {
    await this.database.update(stageRuns).set({ context }).where(eq(stageRuns.id, runId));
  }

  async savePublished(runId: string, published: PublishedWork): Promise<void> {
    await this.database.update(stageRuns).set({ published }).where(eq(stageRuns.id, runId));
  }

  async saveRouteChoice(runId: string, choice: ChosenRoute): Promise<void> {
    await this.database.update(stageRuns).set({ choice }).where(eq(stageRuns.id, runId));
  }

  async saveWaitingSince(runId: string, waitingSince: Date | undefined): Promise<void> {
    await this.database
      .update(stageRuns)
      .set({ waitingSince: waitingSince ?? null })
      .where(eq(stageRuns.id, runId));
  }

  async update<Change extends StageRunChange | undefined>(
    runId: string,
    change: (run: StageRun) => Change,
  ): Promise<Change> {
    return this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select(stageRunColumns)
        .from(stageRuns)
        .where(eq(stageRuns.id, runId))
        .for("update");
      if (!row) throw new Error(`There is no Stage run ${runId} to change.`);
      const changed = change(stageRunOf(row));
      if (changed) {
        await transaction
          .update(stageRuns)
          .set(changedColumns(changed.run))
          .where(eq(stageRuns.id, runId));
      }
      return changed;
    });
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

  async latestTasksUsage(
    taskIds: readonly string[],
    limit: number,
  ): Promise<readonly StageRunUsage[]> {
    if (taskIds.length === 0) return [];
    const ended = and(inArray(stageRuns.taskId, [...taskIds]), isNotNull(stageRuns.endedAt));
    const latestTasks = this.database
      .select({ taskId: stageRuns.taskId })
      .from(stageRuns)
      .where(ended)
      .groupBy(stageRuns.taskId)
      .orderBy(desc(max(stageRuns.endedAt)), asc(stageRuns.taskId))
      .limit(limit);
    const rows = await this.database
      .select({
        taskId: stageRuns.taskId,
        stageKey: stageRuns.stageKey,
        engineId: stageRuns.engineId,
        model: stageRuns.model,
        tokens: stageRuns.tokens,
        endedAt: stageRuns.endedAt,
      })
      .from(stageRuns)
      .where(and(ended, inArray(stageRuns.taskId, latestTasks)))
      .orderBy(asc(stageRuns.taskId), asc(stageRuns.number));
    return rows.map(({ engineId, model, endedAt, ...row }) => ({
      ...row,
      engineId: engineId ?? undefined,
      model: model ?? undefined,
      endedAt: endedAt ?? undefined,
    }));
  }

  async startedSince(since: Date): Promise<readonly StartedStageRun[]> {
    const earlier = alias(stageRuns, "earlier");
    const earlierRun = this.database
      .select({ one: sql`1` })
      .from(earlier)
      .where(
        and(
          eq(earlier.taskId, stageRuns.taskId),
          eq(earlier.stageKey, stageRuns.stageKey),
          lt(earlier.number, stageRuns.number),
        ),
      );
    return this.database
      .select({
        taskId: stageRuns.taskId,
        tokens: stageRuns.tokens,
        retry: sql<boolean>`${exists(earlierRun)}`,
      })
      .from(stageRuns)
      .where(gte(stageRuns.startedAt, since));
  }

  async ranBetween(from: Date, to: Date): Promise<readonly RanAgentStageRun[]> {
    const runs = await this.database
      .select({
        engineId: stageRuns.engineId,
        taskId: stageRuns.taskId,
        stageKey: stageRuns.stageKey,
        startedAt: stageRuns.startedAt,
        endedAt: stageRuns.endedAt,
      })
      .from(stageRuns)
      .where(
        and(
          isNotNull(stageRuns.engineId),
          lt(stageRuns.startedAt, to),
          or(isNull(stageRuns.endedAt), gt(stageRuns.endedAt, from)),
        ),
      )
      .orderBy(asc(stageRuns.startedAt), asc(stageRuns.taskId), asc(stageRuns.number));
    const taskIds = [...new Set(runs.map(({ taskId }) => taskId))];
    const stagesOfTasks =
      taskIds.length === 0
        ? []
        : await this.database
            .select({ taskId: taskStages.taskId, stages: taskStages.stages })
            .from(taskStages)
            .where(inArray(taskStages.taskId, taskIds));
    const names = new Map(
      stagesOfTasks.flatMap(({ taskId, stages }) =>
        stages.map(({ key, name }) => [`${taskId} ${key}`, name] as const),
      ),
    );
    return runs.flatMap(({ engineId, taskId, stageKey, startedAt, endedAt }) =>
      engineId === null
        ? []
        : [
            {
              engineId,
              taskId,
              stageName: names.get(`${taskId} ${stageKey}`) ?? stageKey,
              startedAt,
              endedAt: endedAt ?? undefined,
            },
          ],
    );
  }

  async enginesOfTasks(taskIds: readonly string[]): Promise<readonly KeptStageRunEngines[]> {
    if (taskIds.length === 0) return [];
    const rows = await this.database
      .select({
        taskId: stageRuns.taskId,
        number: stageRuns.number,
        engineId: stageRuns.engineId,
        engineName: stageRuns.engineName,
        standInForEngineId: stageRuns.standInForEngineId,
        standInForEngineName: stageRuns.standInForEngineName,
        switches: stageRuns.engineSwitches,
      })
      .from(stageRuns)
      .where(and(inArray(stageRuns.taskId, [...taskIds]), isNotNull(stageRuns.engineId)))
      .orderBy(asc(stageRuns.taskId), asc(stageRuns.number));
    return rows.flatMap(
      ({ engineId, engineName, standInForEngineId, standInForEngineName, ...row }) =>
        engineId === null
          ? []
          : [
              {
                ...row,
                engineId,
                engineName: engineName ?? undefined,
                standInFor:
                  standInForEngineId === null
                    ? undefined
                    : {
                        engineId: standInForEngineId,
                        engineName: standInForEngineName ?? undefined,
                      },
              },
            ],
    );
  }

  async commandOutputs(taskId: string, runId: string): Promise<readonly string[] | undefined> {
    const [row] = await this.database
      .select({ commandRuns: stageRuns.commandRuns, commandOutputs: stageRuns.commandOutputs })
      .from(stageRuns)
      .where(and(eq(stageRuns.taskId, taskId), eq(stageRuns.id, runId)));
    return row?.commandRuns.map(({ output }, index) => row.commandOutputs[index] ?? output);
  }
}

/** The stand-in columns of a run's row, or the clearing of them. */
function standInColumns(standInFor: StageRunStandIn | undefined) {
  return {
    standInForEngineId: standInFor?.engineId ?? null,
    standInForEngineName: standInFor?.engineName ?? null,
    standInReason: standInFor?.reason ?? null,
  };
}

/**
 * The row of a run a change left, every column but those that name it and the commands' whole
 * outputs, which the record doesn't carry; an undefined field clears its column.
 */
function changedColumns({
  id: _named,
  taskId: _ofTheTask,
  number: _placed,
  standInFor,
  ...run
}: StageRun): Partial<typeof stageRuns.$inferInsert> {
  return {
    ...run,
    ...standInColumns(standInFor),
    carriedFailure: run.carriedFailure ?? null,
    sentBack: run.sentBack ?? null,
    restart: run.restart ?? null,
    restarted: run.restarted ?? null,
    startedOver: run.startedOver ?? null,
    threadId: run.threadId ?? null,
    roleKey: run.roleKey ?? null,
    session: run.session ?? null,
    engineId: run.engineId ?? null,
    engineName: run.engineName ?? null,
    model: run.model ?? null,
    context: run.context ?? null,
    headCommit: run.headCommit ?? null,
    changedFiles: run.changedFiles ?? null,
    heldBy: run.heldBy ?? null,
    heldByUser: run.heldByUser ?? null,
    gateAction: run.gateAction ?? null,
    outcome: run.outcome ?? null,
    published: run.published ?? null,
    choice: run.choice ?? null,
    waitingSince: run.waitingSince ?? null,
    endedAt: run.endedAt ?? null,
  };
}

function stageRunOf({
  standInForEngineId,
  standInForEngineName,
  standInReason,
  ...row
}: Omit<typeof stageRuns.$inferSelect, "commandOutputs">): StageRun {
  return {
    ...row,
    standInFor:
      standInForEngineId === null
        ? undefined
        : {
            engineId: standInForEngineId,
            engineName: standInForEngineName ?? standInForEngineId,
            reason: standInReason ?? "",
          },
    carriedFailure: row.carriedFailure ?? undefined,
    sentBack: row.sentBack ?? undefined,
    restart: row.restart ?? undefined,
    restarted: row.restarted ?? undefined,
    startedOver: row.startedOver ?? undefined,
    threadId: row.threadId ?? undefined,
    roleKey: row.roleKey ?? undefined,
    session: row.session ?? undefined,
    engineId: row.engineId ?? undefined,
    engineName: row.engineName ?? undefined,
    model: row.model ?? undefined,
    context: row.context ?? undefined,
    headCommit: row.headCommit ?? undefined,
    changedFiles: row.changedFiles ?? undefined,
    heldBy: row.heldBy ?? undefined,
    heldByUser: row.heldByUser ?? undefined,
    gateAction: row.gateAction ?? undefined,
    outcome: row.outcome ?? undefined,
    published: row.published ?? undefined,
    choice: row.choice ?? undefined,
    waitingSince: row.waitingSince ?? undefined,
    endedAt: row.endedAt ?? undefined,
  };
}

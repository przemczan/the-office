import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { ActionRun, ActionRunRanFrom, ActionRunStatus } from "../../domain/action-run.js";
import {
  ActionRunningAlready,
  ActionRunRepository,
  type ActionRunChange,
} from "../../ports/action-run-repository.js";
import { actionRuns } from "./actions.schema.js";

type Row = typeof actionRuns.$inferSelect;

/** Postgres' unique violation: the partial index on an Action's running run. */
const UNIQUE_VIOLATION = "23505";

@Injectable()
export class PostgresActionRunRepository extends ActionRunRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async add(run: ActionRun): Promise<void> {
    try {
      await this.database.insert(actionRuns).values(rowOf(run));
    } catch (error) {
      if (isUniqueViolation(error)) throw new ActionRunningAlready(run.projectId, run.actionKey);
      throw error;
    }
  }

  async find(id: string): Promise<ActionRun | undefined> {
    const [row] = await this.database.select().from(actionRuns).where(eq(actionRuns.id, id));
    return row && runOf(row);
  }

  async listOfProject(projectId: string): Promise<readonly ActionRun[]> {
    const rows = await this.database
      .select()
      .from(actionRuns)
      .where(eq(actionRuns.projectId, projectId))
      .orderBy(desc(actionRuns.startedAt), desc(actionRuns.id));
    return rows.map(runOf);
  }

  async listOfAction(projectId: string, actionKey: string): Promise<readonly ActionRun[]> {
    const rows = await this.database
      .select()
      .from(actionRuns)
      .where(and(eq(actionRuns.projectId, projectId), eq(actionRuns.actionKey, actionKey)))
      .orderBy(desc(actionRuns.startedAt), desc(actionRuns.id));
    return rows.map(runOf);
  }

  async running(): Promise<readonly ActionRun[]> {
    const rows = await this.database
      .select()
      .from(actionRuns)
      .where(isNull(actionRuns.outcome))
      .orderBy(asc(actionRuns.startedAt), asc(actionRuns.id));
    return rows.map(runOf);
  }

  async ofTestInstance(instanceId: string): Promise<ActionRun | undefined> {
    const [row] = await this.database
      .select()
      .from(actionRuns)
      .where(eq(actionRuns.testInstanceId, instanceId))
      .limit(1);
    return row && runOf(row);
  }

  update(
    id: string,
    change: ActionRunChange,
  ): Promise<{ before: ActionRun; after: ActionRun } | undefined> {
    return this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select()
        .from(actionRuns)
        .where(eq(actionRuns.id, id))
        .for("update");
      if (!row) return undefined;
      const before = runOf(row);
      const after = change(before);
      if (after === undefined) return undefined;
      await transaction.update(actionRuns).set(rowOf(after)).where(eq(actionRuns.id, id));
      return { before, after };
    });
  }

  async remove(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.database.delete(actionRuns).where(inArray(actionRuns.id, [...ids]));
  }
}

function isUniqueViolation(error: unknown): boolean {
  for (let cause: unknown = error; cause instanceof Error; cause = cause.cause) {
    if ((cause as Error & { code?: unknown }).code === UNIQUE_VIOLATION) return true;
  }
  return false;
}

function rowOf(run: ActionRun): Row {
  const { ranFrom } = run;
  return {
    id: run.id,
    projectId: run.projectId,
    actionKey: run.actionKey,
    actionName: run.actionName,
    kind: run.status.kind,
    state: run.status.state,
    outcome: run.outcome ?? null,
    sourceKind: ranFrom.kind,
    sourceId:
      ranFrom.kind === "task"
        ? ranFrom.taskId
        : ranFrom.kind === "initiative"
          ? ranFrom.initiativeId
          : null,
    sourceName:
      ranFrom.kind === "task" ? ranFrom.title : ranFrom.kind === "initiative" ? ranFrom.name : null,
    branch: run.branch,
    commit: run.commit ?? null,
    startCommit: run.startCommit,
    note: run.note ?? null,
    startedBy: run.startedBy,
    startedAt: run.startedAt,
    endedAt: run.endedAt ?? null,
    exitCode: run.exitCode ?? null,
    endedBecause: run.endedBecause ?? null,
    stoppedBy: run.stoppedBy ?? null,
    testInstanceId: run.testInstanceId ?? null,
    workflowFile: run.workflowFile ?? null,
    askedAt: run.askedAt ?? null,
    ciRun: run.ciRun ?? null,
    workflowRunsUrl: run.workflowRunsUrl ?? null,
  };
}

function runOf(row: Row): ActionRun {
  return {
    id: row.id,
    projectId: row.projectId,
    actionKey: row.actionKey,
    actionName: row.actionName,
    status: { kind: row.kind, state: row.state } as ActionRunStatus,
    outcome: row.outcome ?? undefined,
    ranFrom: ranFromOf(row),
    branch: row.branch,
    commit: row.commit ?? undefined,
    startCommit: row.startCommit,
    note: row.note ?? undefined,
    startedBy: row.startedBy,
    startedAt: row.startedAt,
    endedAt: row.endedAt ?? undefined,
    exitCode: row.exitCode ?? undefined,
    endedBecause: row.endedBecause ?? undefined,
    stoppedBy: row.stoppedBy ?? undefined,
    testInstanceId: row.testInstanceId ?? undefined,
    workflowFile: row.workflowFile ?? undefined,
    askedAt: row.askedAt ?? undefined,
    ciRun: row.ciRun ?? undefined,
    workflowRunsUrl: row.workflowRunsUrl ?? undefined,
  };
}

function ranFromOf(row: Row): ActionRunRanFrom {
  switch (row.sourceKind) {
    case "branch":
      return { kind: "branch" };
    case "task":
      return { kind: "task", taskId: row.sourceId ?? "", title: row.sourceName ?? "" };
    case "initiative":
      return { kind: "initiative", initiativeId: row.sourceId ?? "", name: row.sourceName ?? "" };
  }
}

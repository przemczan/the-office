import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, gte, inArray, isNull, type SQL } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import {
  ACTIVE_STATES,
  type TestInstance,
  type TestInstanceChange,
} from "../../domain/test-instance.js";
import { TestInstanceRepository, type BuildsOf } from "../../ports/test-instance-repository.js";
import { testInstances } from "./test-instances.schema.js";

type Row = typeof testInstances.$inferSelect;

@Injectable()
export class PostgresTestInstanceRepository extends TestInstanceRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async add(instance: TestInstance): Promise<void> {
    await this.database.insert(testInstances).values(rowOf(instance));
  }

  async find(id: string): Promise<TestInstance | undefined> {
    const [row] = await this.database.select().from(testInstances).where(eq(testInstances.id, id));
    return row && instanceOf(row);
  }

  async listOf(initiativeId: string): Promise<readonly TestInstance[]> {
    const rows = await this.database
      .select()
      .from(testInstances)
      .where(eq(testInstances.initiativeId, initiativeId))
      .orderBy(desc(testInstances.launchedAt), desc(testInstances.id));
    return rows.map(instanceOf);
  }

  async listOfProject(projectId: string): Promise<readonly TestInstance[]> {
    const rows = await this.database
      .select()
      .from(testInstances)
      .where(eq(testInstances.projectId, projectId))
      .orderBy(desc(testInstances.launchedAt), desc(testInstances.id));
    return rows.map(instanceOf);
  }

  async active(): Promise<readonly TestInstance[]> {
    const rows = await this.database
      .select()
      .from(testInstances)
      .where(inArray(testInstances.state, [...ACTIVE_STATES]))
      .orderBy(testInstances.launchedAt);
    return rows.map(instanceOf);
  }

  async endedSince(at: Date): Promise<readonly TestInstance[]> {
    const rows = await this.database
      .select()
      .from(testInstances)
      .where(and(inArray(testInstances.state, ["built", "failed"]), gte(testInstances.endedAt, at)))
      .orderBy(desc(testInstances.endedAt), desc(testInstances.id));
    return rows.map(instanceOf);
  }

  async builtWithFiles(of?: BuildsOf): Promise<readonly TestInstance[]> {
    const rows = await this.database
      .select()
      .from(testInstances)
      .where(
        and(
          eq(testInstances.state, "built"),
          isNull(testInstances.filesRemovedAt),
          ...(of === undefined ? [] : buildsOf(of)),
        ),
      )
      .orderBy(desc(testInstances.launchedAt), desc(testInstances.id));
    return rows.map(instanceOf);
  }

  async newestBuilt(
    projectId: string,
    targetKey: string,
    branch: string,
  ): Promise<TestInstance | undefined> {
    const [row] = await this.database
      .select()
      .from(testInstances)
      .where(
        and(
          eq(testInstances.projectId, projectId),
          eq(testInstances.targetKey, targetKey),
          eq(testInstances.branch, branch),
          eq(testInstances.state, "built"),
        ),
      )
      .orderBy(desc(testInstances.endedAt), desc(testInstances.launchedAt))
      .limit(1);
    return row && instanceOf(row);
  }

  update(
    id: string,
    change: (instance: TestInstance) => TestInstanceChange,
  ): Promise<TestInstanceChange> {
    return this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select()
        .from(testInstances)
        .where(eq(testInstances.id, id))
        .for("update");
      if (!row) return undefined;
      const changed = change(instanceOf(row));
      if (changed === undefined) return undefined;
      await transaction
        .update(testInstances)
        .set(rowOf(changed.instance))
        .where(eq(testInstances.id, id));
      return changed;
    });
  }
}

function buildsOf(of: BuildsOf): SQL[] {
  return [
    eq(testInstances.projectId, of.projectId),
    eq(testInstances.targetKey, of.targetKey),
    ...("initiativeId" in of
      ? [eq(testInstances.initiativeId, of.initiativeId)]
      : [isNull(testInstances.initiativeId), eq(testInstances.branch, of.branch)]),
  ];
}

function rowOf(instance: TestInstance): Row {
  return {
    id: instance.id,
    initiativeId: instance.initiativeId ?? null,
    projectId: instance.projectId,
    branch: instance.branch ?? null,
    targetKey: instance.targetKey,
    targetName: instance.targetName,
    kind: instance.kind,
    state: instance.state,
    commit: instance.commit ?? null,
    port: instance.port ?? null,
    failedReason: instance.failedReason ?? null,
    launchedBy: instance.launchedBy,
    launchedAt: instance.launchedAt,
    runningAt: instance.runningAt ?? null,
    endedAt: instance.endedAt ?? null,
    files: instance.files,
    filesRemovedAt: instance.filesRemovedAt ?? null,
    actionKey: instance.runAs?.actionKey ?? null,
    actionName: instance.runAs?.actionName ?? null,
    projectDeviceId: instance.device?.projectDeviceId ?? null,
    deviceName: instance.device?.name ?? null,
    deviceKind: instance.device?.kind ?? null,
    buildInstanceId: instance.buildInstanceId ?? null,
    builtForTargetKey: instance.builtFor?.targetKey ?? null,
    builtForTargetName: instance.builtFor?.targetName ?? null,
  };
}

function instanceOf(row: Row): TestInstance {
  return {
    id: row.id,
    initiativeId: row.initiativeId ?? undefined,
    projectId: row.projectId,
    branch: row.branch ?? undefined,
    targetKey: row.targetKey,
    targetName: row.targetName,
    kind: row.kind,
    state: row.state,
    commit: row.commit ?? undefined,
    port: row.port ?? undefined,
    failedReason: row.failedReason ?? undefined,
    launchedBy: row.launchedBy,
    launchedAt: row.launchedAt,
    runningAt: row.runningAt ?? undefined,
    endedAt: row.endedAt ?? undefined,
    files: row.files,
    filesRemovedAt: row.filesRemovedAt ?? undefined,
    runAs:
      row.actionKey === null || row.actionName === null
        ? undefined
        : { actionKey: row.actionKey, actionName: row.actionName },
    device:
      row.projectDeviceId === null || row.deviceName === null || row.deviceKind === null
        ? undefined
        : { projectDeviceId: row.projectDeviceId, name: row.deviceName, kind: row.deviceKind },
    buildInstanceId: row.buildInstanceId ?? undefined,
    builtFor:
      row.builtForTargetKey === null || row.builtForTargetName === null
        ? undefined
        : { targetKey: row.builtForTargetKey, targetName: row.builtForTargetName },
  };
}

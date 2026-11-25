import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type {
  ConnectedDevice,
  ConnectedDeviceChange,
  RunHolder,
} from "../../domain/connected-device.js";
import { ConnectedDeviceRepository } from "../../ports/connected-device-repository.js";
import { connectedDevices } from "./connected-devices.schema.js";

type Row = typeof connectedDevices.$inferSelect;

/** The database, or a transaction on it. */
export type Queries = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

const UNIQUE_VIOLATION = "23505";
const OPEN = ne(connectedDevices.state, "disconnected");

@Injectable()
export class PostgresConnectedDeviceRepository extends ConnectedDeviceRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  insert(device: ConnectedDevice): Promise<{ readonly heldBy?: ConnectedDevice }> {
    return this.insertTrying(device, 2);
  }

  private insertTrying(
    device: ConnectedDevice,
    tries: number,
  ): Promise<{ readonly heldBy?: ConnectedDevice }> {
    return insertConnectedDevice(this.database, device, tries);
  }

  async find(id: string): Promise<ConnectedDevice | undefined> {
    const [row] = await this.database
      .select()
      .from(connectedDevices)
      .where(eq(connectedDevices.id, id));
    return row && connectedDeviceOf(row);
  }

  update(
    id: string,
    change: (device: ConnectedDevice) => ConnectedDeviceChange,
  ): Promise<ConnectedDeviceChange> {
    return this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select()
        .from(connectedDevices)
        .where(eq(connectedDevices.id, id))
        .for("update");
      if (!row) return undefined;
      const changed = change(connectedDeviceOf(row));
      if (changed === undefined) return undefined;
      await transaction
        .update(connectedDevices)
        .set(connectedDeviceRowOf(changed.device))
        .where(eq(connectedDevices.id, id));
      return changed;
    });
  }

  async listOfTask(taskId: string): Promise<readonly ConnectedDevice[]> {
    const rows = await this.database
      .select()
      .from(connectedDevices)
      .where(eq(connectedDevices.taskId, taskId))
      .orderBy(desc(connectedDevices.connectedAt), desc(connectedDevices.id));
    return rows.map(connectedDeviceOf);
  }

  async openOfTask(taskId: string): Promise<readonly ConnectedDevice[]> {
    const rows = await this.database
      .select()
      .from(connectedDevices)
      .where(and(eq(connectedDevices.taskId, taskId), OPEN))
      .orderBy(asc(connectedDevices.connectedAt), asc(connectedDevices.id));
    return rows.map(connectedDeviceOf);
  }

  async openOfProject(projectId: string): Promise<readonly ConnectedDevice[]> {
    const rows = await this.database
      .select()
      .from(connectedDevices)
      .where(and(eq(connectedDevices.projectId, projectId), OPEN))
      .orderBy(asc(connectedDevices.connectedAt));
    return rows.map(connectedDeviceOf);
  }

  openOfProjectDevice(projectDeviceId: string): Promise<ConnectedDevice | undefined> {
    return openOfProjectDevice(this.database, projectDeviceId);
  }

  async allOpen(): Promise<readonly ConnectedDevice[]> {
    const rows = await this.database
      .select()
      .from(connectedDevices)
      .where(OPEN)
      .orderBy(asc(connectedDevices.connectedAt));
    return rows.map(connectedDeviceOf);
  }
}

/**
 * Keeps the record unless an open one holds its device key, answering that one instead; in a
 * transaction, the insert runs in a savepoint of its own, so a refusal leaves the rest standing.
 */
export async function insertConnectedDevice(
  database: Queries,
  device: ConnectedDevice,
  tries = 2,
): Promise<{ readonly heldBy?: ConnectedDevice }> {
  try {
    await database.transaction(async (savepoint) => {
      await savepoint.insert(connectedDevices).values(connectedDeviceRowOf(device));
    });
    return {};
  } catch (error) {
    if (!isUniqueViolation(error) || tries <= 1) throw error;
  }
  const [holder] = await database
    .select()
    .from(connectedDevices)
    .where(and(eq(connectedDevices.deviceKey, device.deviceKey), OPEN));
  // Disconnected between the refusal and this read: the device is free again, so try once more.
  if (holder === undefined) return insertConnectedDevice(database, device, tries - 1);
  return { heldBy: connectedDeviceOf(holder) };
}

/** The record not Disconnected lent from, or held as, the Project device, if one holds it. */
export async function openOfProjectDevice(
  database: Queries,
  projectDeviceId: string,
): Promise<ConnectedDevice | undefined> {
  const [row] = await database
    .select()
    .from(connectedDevices)
    .where(and(eq(connectedDevices.projectDeviceId, projectDeviceId), OPEN))
    .orderBy(asc(connectedDevices.connectedAt))
    .limit(1);
  return row && connectedDeviceOf(row);
}

function isUniqueViolation(error: unknown): boolean {
  const cause = error instanceof Error ? (error.cause ?? error) : error;
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    cause.code === UNIQUE_VIOLATION
  );
}

/** The row of a record, its holder in the column of its kind. */
export function connectedDeviceRowOf(device: ConnectedDevice): Row {
  return {
    id: device.id,
    taskId: device.taskId,
    actionRunId: device.runHolder?.kind === "action-run" ? device.runHolder.actionRunId : null,
    testInstanceId:
      device.runHolder?.kind === "test-instance" ? device.runHolder.testInstanceId : null,
    holderName: device.runHolder?.name ?? null,
    relayTab: device.relayTab,
    everConnected: device.everConnected,
    projectId: device.projectId,
    projectDeviceId: device.projectDeviceId,
    kind: device.kind,
    name: device.name,
    deviceKey: device.deviceKey,
    state: device.state,
    disconnectedBecause: device.disconnectedBecause,
    disconnectedBy: device.disconnectedBy,
    problem: device.problem,
    endpoint: device.endpoint,
    rfc2217Url: device.rfc2217Url,
    baudRate: device.baudRate,
    roundTripMs: device.roundTripMs,
    notice: device.notice,
    connectedBy: device.connectedBy,
    connectedAt: device.connectedAt,
    disconnectedAt: device.disconnectedAt,
  };
}

/** The record of a row, its run holder named by `holder_name`. */
export function connectedDeviceOf(row: Row): ConnectedDevice {
  return {
    id: row.id,
    taskId: row.taskId,
    runHolder: runHolderOf(row),
    relayTab: row.relayTab,
    everConnected: row.everConnected,
    projectId: row.projectId,
    projectDeviceId: row.projectDeviceId,
    kind: row.kind,
    name: row.name,
    deviceKey: row.deviceKey,
    state: row.state,
    disconnectedBecause: row.disconnectedBecause,
    disconnectedBy: row.disconnectedBy,
    problem: row.problem,
    endpoint: row.endpoint,
    rfc2217Url: row.rfc2217Url,
    baudRate: row.baudRate,
    roundTripMs: row.roundTripMs,
    notice: row.notice,
    connectedBy: row.connectedBy,
    connectedAt: row.connectedAt,
    disconnectedAt: row.disconnectedAt,
  };
}

function runHolderOf(row: Row): RunHolder | null {
  const name = row.holderName ?? "";
  if (row.actionRunId !== null) return { kind: "action-run", actionRunId: row.actionRunId, name };
  if (row.testInstanceId !== null) {
    return { kind: "test-instance", testInstanceId: row.testInstanceId, name };
  }
  return null;
}

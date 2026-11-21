import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { ConnectedDevice, ConnectedDeviceChange } from "../../domain/connected-device.js";
import { ConnectedDeviceRepository } from "../../ports/connected-device-repository.js";
import { connectedDevices } from "./connected-devices.schema.js";

type Row = typeof connectedDevices.$inferSelect;

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

  private async insertTrying(
    device: ConnectedDevice,
    tries: number,
  ): Promise<{ readonly heldBy?: ConnectedDevice }> {
    try {
      await this.database.insert(connectedDevices).values(rowOf(device));
      return {};
    } catch (error) {
      if (!isUniqueViolation(error) || tries <= 1) throw error;
    }
    const [holder] = await this.database
      .select()
      .from(connectedDevices)
      .where(and(eq(connectedDevices.deviceKey, device.deviceKey), OPEN));
    // Disconnected between the refusal and this read: the device is free again, so try once more.
    if (holder === undefined) return this.insertTrying(device, tries - 1);
    return { heldBy: deviceOf(holder) };
  }

  async find(id: string): Promise<ConnectedDevice | undefined> {
    const [row] = await this.database
      .select()
      .from(connectedDevices)
      .where(eq(connectedDevices.id, id));
    return row && deviceOf(row);
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
      const changed = change(deviceOf(row));
      if (changed === undefined) return undefined;
      await transaction
        .update(connectedDevices)
        .set(rowOf(changed.device))
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
    return rows.map(deviceOf);
  }

  async openOfTask(taskId: string): Promise<readonly ConnectedDevice[]> {
    const rows = await this.database
      .select()
      .from(connectedDevices)
      .where(and(eq(connectedDevices.taskId, taskId), OPEN))
      .orderBy(asc(connectedDevices.connectedAt), asc(connectedDevices.id));
    return rows.map(deviceOf);
  }

  async openOfProject(projectId: string): Promise<readonly ConnectedDevice[]> {
    const rows = await this.database
      .select()
      .from(connectedDevices)
      .where(and(eq(connectedDevices.projectId, projectId), OPEN))
      .orderBy(asc(connectedDevices.connectedAt));
    return rows.map(deviceOf);
  }

  async allOpen(): Promise<readonly ConnectedDevice[]> {
    const rows = await this.database
      .select()
      .from(connectedDevices)
      .where(OPEN)
      .orderBy(asc(connectedDevices.connectedAt));
    return rows.map(deviceOf);
  }
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

function rowOf(device: ConnectedDevice): Row {
  return {
    id: device.id,
    taskId: device.taskId,
    projectId: device.projectId,
    kind: device.kind,
    name: device.name,
    deviceKey: device.deviceKey,
    state: device.state,
    disconnectedBecause: device.disconnectedBecause,
    disconnectedBy: device.disconnectedBy,
    problem: device.problem,
    endpoint: device.endpoint,
    baudRate: device.baudRate,
    roundTripMs: device.roundTripMs,
    notice: device.notice,
    connectedBy: device.connectedBy,
    connectedAt: device.connectedAt,
    disconnectedAt: device.disconnectedAt,
  };
}

function deviceOf(row: Row): ConnectedDevice {
  return {
    id: row.id,
    taskId: row.taskId,
    projectId: row.projectId,
    kind: row.kind,
    name: row.name,
    deviceKey: row.deviceKey,
    state: row.state,
    disconnectedBecause: row.disconnectedBecause,
    disconnectedBy: row.disconnectedBy,
    problem: row.problem,
    endpoint: row.endpoint,
    baudRate: row.baudRate,
    roundTripMs: row.roundTripMs,
    notice: row.notice,
    connectedBy: row.connectedBy,
    connectedAt: row.connectedAt,
    disconnectedAt: row.disconnectedAt,
  };
}

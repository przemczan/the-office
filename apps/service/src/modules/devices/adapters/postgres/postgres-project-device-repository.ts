import { Inject, Injectable } from "@nestjs/common";
import { asc, eq, isNotNull } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { ProjectDevice, ProjectDeviceChange } from "../../domain/project-device.js";
import {
  ProjectDeviceRepository,
  type LockedProjectDevice,
  type ProjectDeviceUpdate,
} from "../../ports/project-device-repository.js";
import {
  insertConnectedDevice,
  openOfProjectDevice,
  type Queries,
} from "./postgres-connected-device-repository.js";
import { projectDevices } from "./project-devices.schema.js";

type Row = typeof projectDevices.$inferSelect;

const UNIQUE_VIOLATION = "23505";
const DEVICE_KEY_INDEX = "project_devices_project_device_key";

@Injectable()
export class PostgresProjectDeviceRepository extends ProjectDeviceRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async insert(device: ProjectDevice): Promise<"kept" | "device-key-taken"> {
    try {
      await this.database.insert(projectDevices).values(rowOf(device));
      return "kept";
    } catch (error) {
      if (isDeviceKeyTaken(error)) return "device-key-taken";
      throw error;
    }
  }

  async find(id: string): Promise<ProjectDevice | undefined> {
    const [row] = await this.database
      .select()
      .from(projectDevices)
      .where(eq(projectDevices.id, id));
    return row && deviceOf(row);
  }

  async listOf(projectId: string): Promise<readonly ProjectDevice[]> {
    const rows = await this.database
      .select()
      .from(projectDevices)
      .where(eq(projectDevices.projectId, projectId))
      .orderBy(asc(projectDevices.addedAt), asc(projectDevices.id));
    return rows.map(deviceOf);
  }

  async update(
    id: string,
    change: (device: ProjectDevice) => ProjectDeviceChange,
  ): Promise<ProjectDeviceUpdate> {
    try {
      return await this.database.transaction(async (transaction) => {
        const [row] = await transaction
          .select()
          .from(projectDevices)
          .where(eq(projectDevices.id, id))
          .for("update");
        if (!row) return { kind: "missing" } as const;
        const changed = change(deviceOf(row));
        if (changed === undefined) return { kind: "unchanged" } as const;
        await transaction
          .update(projectDevices)
          .set(rowOf(changed.device))
          .where(eq(projectDevices.id, id));
        return { kind: "changed", change: changed } as const;
      });
    } catch (error) {
      if (isDeviceKeyTaken(error)) return { kind: "device-key-taken" };
      throw error;
    }
  }

  async remove(id: string): Promise<boolean> {
    const removed = await this.database
      .delete(projectDevices)
      .where(eq(projectDevices.id, id))
      .returning({ id: projectDevices.id });
    return removed.length > 0;
  }

  withDeviceLocked<Result>(
    id: string,
    work: (locked: LockedProjectDevice | undefined) => Promise<Result>,
  ): Promise<Result> {
    return this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select()
        .from(projectDevices)
        .where(eq(projectDevices.id, id))
        .for("update");
      return work(row && lockedOf(transaction, deviceOf(row)));
    });
  }

  async pairing(): Promise<readonly ProjectDevice[]> {
    const rows = await this.database
      .select()
      .from(projectDevices)
      .where(isNotNull(projectDevices.pairingStep));
    return rows.map(deviceOf);
  }
}

/** The held row's unit of work, each write in a savepoint, so a refused one leaves the rest. */
function lockedOf(transaction: Queries, device: ProjectDevice): LockedProjectDevice {
  return {
    device,
    holding: () => openOfProjectDevice(transaction, device.id),
    insertRecord: (record) => insertConnectedDevice(transaction, record),
    update: async (change) => {
      const changed = change(device);
      if (changed === undefined) return { kind: "unchanged" };
      try {
        await transaction.transaction(async (savepoint) => {
          await savepoint
            .update(projectDevices)
            .set(rowOf(changed.device))
            .where(eq(projectDevices.id, device.id));
        });
        return { kind: "changed", change: changed };
      } catch (error) {
        if (isDeviceKeyTaken(error)) return { kind: "device-key-taken" };
        throw error;
      }
    },
    remove: async () => {
      await transaction.delete(projectDevices).where(eq(projectDevices.id, device.id));
    },
  };
}

function isDeviceKeyTaken(error: unknown): boolean {
  const cause = error instanceof Error ? (error.cause ?? error) : error;
  if (typeof cause !== "object" || cause === null || !("code" in cause)) return false;
  if (cause.code !== UNIQUE_VIOLATION) return false;
  return !("constraint_name" in cause) || cause.constraint_name === DEVICE_KEY_INDEX;
}

function rowOf(device: ProjectDevice): Row {
  return {
    id: device.id,
    projectId: device.projectId,
    kind: device.kind,
    deviceKey: device.deviceKey,
    name: device.name,
    address: device.address,
    port: device.port,
    state: device.state,
    pairingStep: device.pairingStep,
    pairingProblem: device.pairingProblem,
    addedBy: device.addedBy,
    addedAt: device.addedAt,
    lastUse: device.lastUse,
  };
}

function deviceOf(row: Row): ProjectDevice {
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind,
    deviceKey: row.deviceKey,
    name: row.name,
    address: row.address,
    port: row.port,
    state: row.state,
    pairingStep: row.pairingStep,
    pairingProblem: row.pairingProblem,
    addedBy: row.addedBy,
    addedAt: row.addedAt,
    lastUse: row.lastUse,
  };
}

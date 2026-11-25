import type { ConnectedDevice } from "../domain/connected-device.js";
import type { ProjectDevice, ProjectDeviceChange } from "../domain/project-device.js";

/** How an update ended: changed, nothing to change, no such device, or its new key taken. */
export type ProjectDeviceUpdate =
  | { readonly kind: "changed"; readonly change: NonNullable<ProjectDeviceChange> }
  | { readonly kind: "unchanged" | "missing" | "device-key-taken" };

/**
 * A Project device's row held for one unit of work, so a holder's check and the write after it
 * see no other holder come between (spec §2.13, "One environment at a time").
 */
export interface LockedProjectDevice {
  readonly device: ProjectDevice;
  /** The record not Disconnected naming it, if one holds it. */
  holding(): Promise<ConnectedDevice | undefined>;
  /**
   * Keeps a Connected device record, unless an open one holds its device key: storage refuses
   * the second, and that one is answered instead.
   */
  insertRecord(record: ConnectedDevice): Promise<{ readonly heldBy?: ConnectedDevice }>;
  /** Applies the change; a new device key another of the Project's devices has is refused. */
  update(change: (device: ProjectDevice) => ProjectDeviceChange): Promise<ProjectDeviceUpdate>;
  /** Forgets the device. */
  remove(): Promise<void>;
}

/** Where each Project's devices are kept, until removed. */
export abstract class ProjectDeviceRepository {
  /**
   * Keeps the new device, unless the Project has one with its device key: storage refuses the
   * second, never checked before the insert.
   */
  abstract insert(device: ProjectDevice): Promise<"kept" | "device-key-taken">;

  abstract find(id: string): Promise<ProjectDevice | undefined>;

  /** The Project's devices in the order added. */
  abstract listOf(projectId: string): Promise<readonly ProjectDevice[]>;

  /**
   * Applies the change inside a transaction holding the row; a change that throws keeps nothing
   * and throws on. A new device key another of the Project's devices has is refused by storage.
   */
  abstract update(
    id: string,
    change: (device: ProjectDevice) => ProjectDeviceChange,
  ): Promise<ProjectDeviceUpdate>;

  /** Forgets the device; false when there was none. */
  abstract remove(id: string): Promise<boolean>;

  /**
   * Runs `work` holding the device's row until it ends (`SELECT … FOR UPDATE` in one
   * transaction); undefined for a device that isn't there. A `work` that throws keeps nothing.
   */
  abstract withDeviceLocked<Result>(
    id: string,
    work: (locked: LockedProjectDevice | undefined) => Promise<Result>,
  ): Promise<Result>;

  /** Every device with a pairing step, for the startup sweep. */
  abstract pairing(): Promise<readonly ProjectDevice[]>;
}

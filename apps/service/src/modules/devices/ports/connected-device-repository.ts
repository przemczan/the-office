import type { ConnectedDevice, ConnectedDeviceChange } from "../domain/connected-device.js";

/** Where Connected devices are kept, the Disconnected ones as each Task's history. */
export abstract class ConnectedDeviceRepository {
  /**
   * Keeps the new record, unless an open one holds its device key: storage refuses the second, and
   * that one is answered instead, never checked before the insert.
   */
  abstract insert(device: ConnectedDevice): Promise<{ readonly heldBy?: ConnectedDevice }>;

  abstract find(id: string): Promise<ConnectedDevice | undefined>;

  /** Applies the change inside a transaction holding the row; undefined when nothing changed. */
  abstract update(
    id: string,
    change: (device: ConnectedDevice) => ConnectedDeviceChange,
  ): Promise<ConnectedDeviceChange>;

  /** The Task's devices, the newest connected first, Disconnected ones too. */
  abstract listOfTask(taskId: string): Promise<readonly ConnectedDevice[]>;

  /** The Task's devices not Disconnected, the oldest connected first. */
  abstract openOfTask(taskId: string): Promise<readonly ConnectedDevice[]>;

  /** The devices not Disconnected of every Task of the Project. */
  abstract openOfProject(projectId: string): Promise<readonly ConnectedDevice[]>;

  /** Every device not Disconnected, for the startup sweep. */
  abstract allOpen(): Promise<readonly ConnectedDevice[]>;
}

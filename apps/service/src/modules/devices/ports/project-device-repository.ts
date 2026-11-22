import type { ProjectDevice, ProjectDeviceChange } from "../domain/project-device.js";

/** How an update ended: changed, nothing to change, no such device, or its new key taken. */
export type ProjectDeviceUpdate =
  | { readonly kind: "changed"; readonly change: NonNullable<ProjectDeviceChange> }
  | { readonly kind: "unchanged" | "missing" | "device-key-taken" };

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

  /** Every device with a pairing step, for the startup sweep. */
  abstract pairing(): Promise<readonly ProjectDevice[]>;
}

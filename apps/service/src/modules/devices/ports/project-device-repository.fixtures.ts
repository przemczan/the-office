import type { ProjectDevice, ProjectDeviceChange } from "../domain/project-device.js";
import { ProjectDeviceRepository, type ProjectDeviceUpdate } from "./project-device-repository.js";

/** Project devices in memory, a device key unique per Project as the index holds it. */
export class ProjectDevicesForTests extends ProjectDeviceRepository {
  readonly devices = new Map<string, ProjectDevice>();

  insert(device: ProjectDevice): Promise<"kept" | "device-key-taken"> {
    if (this.keyTaken(device)) return Promise.resolve("device-key-taken");
    this.devices.set(device.id, device);
    return Promise.resolve("kept");
  }

  find(id: string): Promise<ProjectDevice | undefined> {
    return Promise.resolve(this.devices.get(id));
  }

  listOf(projectId: string): Promise<readonly ProjectDevice[]> {
    return Promise.resolve(
      [...this.devices.values()]
        .filter((device) => device.projectId === projectId)
        .toSorted((first, second) => first.addedAt.getTime() - second.addedAt.getTime()),
    );
  }

  update(
    id: string,
    change: (device: ProjectDevice) => ProjectDeviceChange,
  ): Promise<ProjectDeviceUpdate> {
    const device = this.devices.get(id);
    if (device === undefined) return Promise.resolve({ kind: "missing" });
    try {
      const changed = change(device);
      if (changed === undefined) return Promise.resolve({ kind: "unchanged" });
      if (this.keyTaken(changed.device)) return Promise.resolve({ kind: "device-key-taken" });
      this.devices.set(id, changed.device);
      return Promise.resolve({ kind: "changed", change: changed });
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  remove(id: string): Promise<boolean> {
    return Promise.resolve(this.devices.delete(id));
  }

  pairing(): Promise<readonly ProjectDevice[]> {
    return Promise.resolve(
      [...this.devices.values()].filter(({ pairingStep }) => pairingStep !== null),
    );
  }

  private keyTaken(device: ProjectDevice): boolean {
    return [...this.devices.values()].some(
      (kept) =>
        kept.id !== device.id &&
        kept.projectId === device.projectId &&
        kept.deviceKey === device.deviceKey,
    );
  }
}

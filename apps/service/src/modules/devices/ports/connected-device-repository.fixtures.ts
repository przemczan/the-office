import type { ConnectedDevice, ConnectedDeviceChange } from "../domain/connected-device.js";
import { ConnectedDeviceRepository } from "./connected-device-repository.js";

/** Connected devices in memory, a device key held by one open record as the index holds it. */
export class ConnectedDevicesForTests extends ConnectedDeviceRepository {
  readonly devices = new Map<string, ConnectedDevice>();

  insert(device: ConnectedDevice): Promise<{ readonly heldBy?: ConnectedDevice }> {
    const holder = [...this.devices.values()].find(
      (kept) => kept.deviceKey === device.deviceKey && kept.state !== "disconnected",
    );
    if (holder !== undefined) return Promise.resolve({ heldBy: holder });
    this.devices.set(device.id, device);
    return Promise.resolve({});
  }

  find(id: string): Promise<ConnectedDevice | undefined> {
    return Promise.resolve(this.devices.get(id));
  }

  update(
    id: string,
    change: (device: ConnectedDevice) => ConnectedDeviceChange,
  ): Promise<ConnectedDeviceChange> {
    const device = this.devices.get(id);
    const changed = device && change(device);
    if (changed !== undefined) this.devices.set(id, changed.device);
    return Promise.resolve(changed);
  }

  listOfTask(taskId: string): Promise<readonly ConnectedDevice[]> {
    return Promise.resolve(
      this.all()
        .filter((device) => device.taskId === taskId)
        .toReversed(),
    );
  }

  openOfTask(taskId: string): Promise<readonly ConnectedDevice[]> {
    return Promise.resolve(this.open().filter((device) => device.taskId === taskId));
  }

  openOfProject(projectId: string): Promise<readonly ConnectedDevice[]> {
    return Promise.resolve(this.open().filter((device) => device.projectId === projectId));
  }

  allOpen(): Promise<readonly ConnectedDevice[]> {
    return Promise.resolve(this.open());
  }

  private all(): ConnectedDevice[] {
    return [...this.devices.values()].toSorted(
      (first, second) => first.connectedAt.getTime() - second.connectedAt.getTime(),
    );
  }

  private open(): ConnectedDevice[] {
    return this.all().filter((device) => device.state !== "disconnected");
  }
}

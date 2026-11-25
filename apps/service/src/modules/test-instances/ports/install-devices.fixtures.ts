import { randomUUID } from "node:crypto";
import { TestInstanceRefused } from "../domain/test-instance-refused.js";
import {
  InstallDevices,
  type InstallHold,
  type InstallHoldRequest,
  type ProjectDeviceOf,
} from "./install-devices.js";

/**
 * Devices' Project devices in memory: a device is free unless `inUse` names its holder, and a hold
 * answers as `onHold` says, by default held at `serial`. Letting go of a hold ends it Disconnected,
 * as Devices' does, and `endHold` ends one as the Run environment turned Off would.
 */
export class InstallDevicesForTests extends InstallDevices {
  /** Each Project's devices. */
  readonly devices = new Map<string, ProjectDeviceOf[]>();
  /** The holder of each device in use, by the device's id. */
  readonly inUse = new Map<string, string>();
  /** Every hold asked for. */
  readonly holds: InstallHoldRequest[] = [];
  /** The holds not let go of yet, by their id, with their instance. */
  readonly open = new Map<string, string>();
  /** Every hold let go of, by its id, in order. */
  readonly letGoOf: string[] = [];
  serial = "192.168.1.20:5555";
  onHold: (request: InstallHoldRequest) => Promise<InstallHold> = () =>
    Promise.resolve({ held: true, holdId: randomUUID(), serial: this.serial });
  private readonly listeners: ((testInstanceId: string, holdId: string) => void)[] = [];

  put(projectId: string, device: ProjectDeviceOf): void {
    this.devices.set(projectId, [...(this.devices.get(projectId) ?? []), device]);
  }

  devicesOf(projectId: string): Promise<readonly ProjectDeviceOf[]> {
    return Promise.resolve(this.devices.get(projectId) ?? []);
  }

  checkFree(projectId: string, projectDeviceId: string): Promise<ProjectDeviceOf> {
    try {
      return Promise.resolve(this.free(projectId, projectDeviceId));
    } catch (error) {
      return Promise.reject(error as Error);
    }
  }

  async hold(request: InstallHoldRequest): Promise<InstallHold> {
    const device = this.free(request.projectId, request.projectDeviceId);
    this.holds.push(request);
    const hold = await this.onHold(request);
    if (hold.held) {
      this.open.set(hold.holdId, request.instanceId);
      this.inUse.set(device.id, request.holderName);
    }
    return hold;
  }

  letGo(holdId: string): Promise<void> {
    this.end(holdId);
    this.letGoOf.push(holdId);
    return Promise.resolve();
  }

  onHoldEnded(listener: (testInstanceId: string, holdId: string) => void): void {
    this.listeners.push(listener);
  }

  /** Ends the instance's open hold Disconnected, as the Run environment turned Off does. */
  endHold(instanceId: string): void {
    for (const [holdId, holder] of this.open) {
      if (holder === instanceId) this.end(holdId);
    }
  }

  private end(holdId: string): void {
    const instanceId = this.open.get(holdId);
    if (instanceId === undefined) return;
    this.open.delete(holdId);
    const request = this.holds.find((each) => each.instanceId === instanceId);
    if (request) this.inUse.delete(request.projectDeviceId);
    for (const listener of this.listeners) listener(instanceId, holdId);
  }

  private free(projectId: string, projectDeviceId: string): ProjectDeviceOf {
    const device = this.devices.get(projectId)?.find(({ id }) => id === projectDeviceId);
    if (!device) throw new TestInstanceRefused(["That device isn't one of the Project's devices."]);
    const holder = this.inUse.get(projectDeviceId);
    if (holder !== undefined) {
      throw new TestInstanceRefused([`${device.name} is in use by ${holder}.`]);
    }
    return device;
  }
}

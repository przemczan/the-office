import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../../platform/events/event-bus.js";
import {
  ConnectedDeviceChanged,
  ProjectDeviceRefused,
  ProjectDevices,
} from "../../../devices/index.js";
import { TestInstanceRefused } from "../../domain/test-instance-refused.js";
import {
  InstallDevices,
  type InstallHold,
  type InstallHoldRequest,
  type ProjectDeviceOf,
} from "../../ports/install-devices.js";

/**
 * Devices' Project devices, through its public interface; its refusals come out as this module's,
 * in the same words.
 */
@Injectable()
export class DevicesInstallDevices extends InstallDevices {
  constructor(
    private readonly devices: ProjectDevices,
    private readonly events: EventBus,
  ) {
    super();
  }

  async devicesOf(projectId: string): Promise<readonly ProjectDeviceOf[]> {
    const seen = await this.devices.list(projectId).catch(() => []);
    return seen.map(({ device }) => ({ id: device.id, name: device.name, kind: device.kind }));
  }

  checkFree(projectId: string, projectDeviceId: string): Promise<ProjectDeviceOf> {
    return translated(() => this.devices.checkFree(projectId, projectDeviceId));
  }

  hold(request: InstallHoldRequest): Promise<InstallHold> {
    return translated(async () => {
      const hold = await this.devices.hold({
        projectId: request.projectId,
        projectDeviceId: request.projectDeviceId,
        holder: {
          kind: "test-instance",
          testInstanceId: request.instanceId,
          name: request.holderName,
        },
        startedBy: request.startedBy,
        environment: request.environment,
        ...(request.relayTab === undefined ? {} : { relayTab: request.relayTab }),
        signal: request.signal,
      });
      return hold.held
        ? { held: true, holdId: hold.holdId, serial: hold.serial }
        : { held: false, holdId: hold.holdId, problem: hold.problem };
    });
  }

  letGo(holdId: string): Promise<void> {
    return this.devices.letGo(holdId);
  }

  onHoldEnded(listener: (testInstanceId: string, holdId: string) => void): void {
    this.events.subscribe(ConnectedDeviceChanged, ({ deviceId, state, runHolder }) => {
      if (runHolder?.kind !== "test-instance" || state !== "disconnected") return;
      listener(runHolder.testInstanceId, deviceId);
    });
  }
}

async function translated<Result>(step: () => Promise<Result>): Promise<Result> {
  try {
    return await step();
  } catch (error) {
    if (error instanceof ProjectDeviceRefused) throw new TestInstanceRefused(error.reasons);
    throw error;
  }
}

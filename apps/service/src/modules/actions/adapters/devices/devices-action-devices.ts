import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../../platform/events/event-bus.js";
import {
  ConnectedDeviceChanged,
  ConnectedDevices,
  ProjectDeviceRefused,
  ProjectDevices,
} from "../../../devices/index.js";
import { ActionRunRefused } from "../../domain/action-run-refused.js";
import {
  ActionDevices,
  type ActionDevice,
  type ActionDeviceHold,
  type ActionDeviceHoldDisconnected,
  type ActionDeviceHoldRequest,
} from "../../ports/action-devices.js";

/** Devices' `ProjectDevices`: a Project command run's hold of its Project device, and its end. */
@Injectable()
export class DevicesActionDevices extends ActionDevices {
  constructor(
    private readonly projectDevices: ProjectDevices,
    private readonly connectedDevices: ConnectedDevices,
    private readonly events: EventBus,
  ) {
    super();
  }

  async deviceOf(projectId: string, projectDeviceId: string): Promise<ActionDevice | undefined> {
    try {
      const { device } = await this.projectDevices.read(projectDeviceId);
      return device.projectId === projectId ? { id: device.id, name: device.name } : undefined;
    } catch (error) {
      if (error instanceof Error && error.name === "ProjectDeviceNotFound") return undefined;
      throw error;
    }
  }

  async checkFree(projectId: string, projectDeviceId: string): Promise<void> {
    await refusedInActionsWords(() => this.projectDevices.checkFree(projectId, projectDeviceId));
  }

  async hold(request: ActionDeviceHoldRequest): Promise<ActionDeviceHold> {
    const { environment } = request;
    const hold = await refusedInActionsWords(() =>
      this.projectDevices.hold({
        projectId: request.projectId,
        projectDeviceId: request.projectDeviceId,
        holder: { kind: "action-run", actionRunId: request.actionRunId, name: request.holderName },
        startedBy: request.startedBy,
        environment: {
          label: `the Action run ${request.actionRunId}`,
          checksUser: environment.checksUser,
          attach: (attachment) => environment.attach(attachment),
        },
        ...(request.relayTab === undefined ? {} : { relayTab: request.relayTab }),
        signal: request.signal,
      }),
    );
    if (hold.held) return { held: true, holdId: hold.holdId, variables: hold.variables };
    return { held: false, problem: hold.problem };
  }

  letGo(holdId: string): Promise<void> {
    return this.projectDevices.letGo(holdId);
  }

  onHoldDisconnected(listener: (hold: ActionDeviceHoldDisconnected) => void): void {
    this.events.subscribe(ConnectedDeviceChanged, ({ deviceId, state, runHolder }) => {
      if (state !== "disconnected" || runHolder?.kind !== "action-run") return;
      listener({ actionRunId: runHolder.actionRunId, holdId: deviceId });
    });
  }

  async endedFromOutside(holdId: string): Promise<string | undefined> {
    const device = await this.connectedDevices.read(holdId);
    switch (device.disconnectedBecause) {
      case null:
      case "run-ended":
        return undefined;
      case "run-environment-turned-off":
        return "Run environment turned Off";
      case "connected-devices-switched-off":
        return "Connected devices switched off";
      case "tab-closed":
        return "the tab relaying it was closed";
      case "device-unplugged":
        return device.problem ?? "it was unplugged";
      case "by-user":
        return `${device.disconnectedBy?.name ?? "a user"} disconnected it`;
      case "task-ended":
        return "its holder ended";
      case "error":
        return device.problem ?? "it failed";
    }
  }
}

/** Devices' refusal at a hold's start, in its words: "Pixel is in use by Lint on main." */
async function refusedInActionsWords<Answer>(asked: () => Promise<Answer>): Promise<Answer> {
  try {
    return await asked();
  } catch (error) {
    if (error instanceof ProjectDeviceRefused) throw new ActionRunRefused(error.reasons);
    throw error;
  }
}

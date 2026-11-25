import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { ConnectedDeviceWebEvent } from "@the-office/contracts";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import { ConnectedDeviceChanged } from "../../domain/connected-device-events.js";

/**
 * Every change to a device reaches the web as `connected-device.changed`: for its Task's page, or,
 * for a run's hold, for the tab named by `relayTab`, which opens the device's relay while it is
 * Connecting. A change that doesn't say its state stays inside the service.
 */
@Injectable()
export class ConnectedDeviceWebEvents implements OnModuleInit {
  constructor(private readonly forwarding: WebEventForwarding) {}

  onModuleInit(): void {
    this.forwarding.forward(
      ConnectedDeviceChanged,
      ({
        taskId,
        deviceId,
        relayTab,
        projectDeviceId,
        state,
      }): Omit<ConnectedDeviceWebEvent, "occurredAt"> | undefined =>
        state === null
          ? undefined
          : {
              type: "connected-device.changed",
              taskId,
              deviceId,
              relayTab,
              projectDeviceId,
              state,
            },
    );
  }
}

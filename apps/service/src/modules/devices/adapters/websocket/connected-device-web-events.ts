import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { ConnectedDeviceWebEvent } from "@the-office/contracts";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import { ConnectedDeviceChanged } from "../../domain/connected-device-events.js";

/** Every change to a device reaches the web as `connected-device.changed`, for its Task's page. */
@Injectable()
export class ConnectedDeviceWebEvents implements OnModuleInit {
  constructor(private readonly forwarding: WebEventForwarding) {}

  onModuleInit(): void {
    this.forwarding.forward(
      ConnectedDeviceChanged,
      ({ taskId, deviceId }): Omit<ConnectedDeviceWebEvent, "occurredAt"> => ({
        type: "connected-device.changed",
        taskId,
        deviceId,
      }),
    );
  }
}

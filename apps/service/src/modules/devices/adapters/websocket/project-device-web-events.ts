import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { ProjectDeviceWebEvent } from "@the-office/contracts";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import { ProjectDeviceChanged } from "../../domain/project-device-events.js";

/** Every change to a Project's devices reaches the web as `project-device.changed`, for its page. */
@Injectable()
export class ProjectDeviceWebEvents implements OnModuleInit {
  constructor(private readonly forwarding: WebEventForwarding) {}

  onModuleInit(): void {
    this.forwarding.forward(
      ProjectDeviceChanged,
      ({ projectId }): Omit<ProjectDeviceWebEvent, "occurredAt"> => ({
        type: "project-device.changed",
        projectId,
      }),
    );
  }
}

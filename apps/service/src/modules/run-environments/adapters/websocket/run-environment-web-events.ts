import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { RunEnvironmentWebEvent } from "@the-office/contracts";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import { RunEnvironmentSettingsChanged } from "../../domain/run-environment-events.js";

type WebEventOf<Type extends RunEnvironmentWebEvent["type"]> = Omit<
  Extract<RunEnvironmentWebEvent, { type: Type }>,
  "occurredAt"
>;

/**
 * A change to the run environments' Office limits reaches the web, so Settings › Office limits
 * reads them again.
 */
@Injectable()
export class RunEnvironmentWebEvents implements OnModuleInit {
  constructor(private readonly forwarding: WebEventForwarding) {}

  onModuleInit(): void {
    this.forwarding.forward(
      RunEnvironmentSettingsChanged,
      (): WebEventOf<"run-environment-settings.changed"> => ({
        type: "run-environment-settings.changed",
      }),
    );
  }
}

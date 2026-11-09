import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { RunEnvironmentWebEvent } from "@the-office/contracts";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import { RunEnvironmentCpuLimitChanged } from "../../domain/run-environment-events.js";

type WebEventOf<Type extends RunEnvironmentWebEvent["type"]> = Omit<
  Extract<RunEnvironmentWebEvent, { type: Type }>,
  "occurredAt"
>;

/** A change to the CPU limit reaches the web, so Settings › Office limits reads it again. */
@Injectable()
export class RunEnvironmentWebEvents implements OnModuleInit {
  constructor(private readonly forwarding: WebEventForwarding) {}

  onModuleInit(): void {
    this.forwarding.forward(
      RunEnvironmentCpuLimitChanged,
      (): WebEventOf<"run-environment-cpu-limit.changed"> => ({
        type: "run-environment-cpu-limit.changed",
      }),
    );
  }
}

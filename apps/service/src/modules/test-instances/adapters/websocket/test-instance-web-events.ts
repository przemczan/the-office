import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { TestInstanceWebEvent } from "@the-office/contracts";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import {
  TestInstanceCommitRecorded,
  TestInstanceLaunched,
  TestInstanceSettingsChanged,
  TestInstanceStateChanged,
} from "../../domain/test-instance-events.js";

type WebEventOf<Type extends TestInstanceWebEvent["type"]> = Omit<
  Extract<TestInstanceWebEvent, { type: Type }>,
  "occurredAt"
>;

function changed({
  instanceId,
  initiativeId,
}: {
  readonly instanceId: string;
  readonly initiativeId: string;
}): WebEventOf<"test-instance.changed"> {
  return { type: "test-instance.changed", instanceId, initiativeId };
}

/**
 * A launch, a state change or a recorded commit reaches the web as `test-instance.changed`, so the
 * Initiative's block reads it again; a change to the limits as `test-instance-settings.changed`.
 */
@Injectable()
export class TestInstanceWebEvents implements OnModuleInit {
  constructor(private readonly forwarding: WebEventForwarding) {}

  onModuleInit(): void {
    this.forwarding.forward(TestInstanceLaunched, changed);
    this.forwarding.forward(TestInstanceStateChanged, changed);
    this.forwarding.forward(TestInstanceCommitRecorded, changed);
    this.forwarding.forward(
      TestInstanceSettingsChanged,
      (): WebEventOf<"test-instance-settings.changed"> => ({
        type: "test-instance-settings.changed",
      }),
    );
  }
}

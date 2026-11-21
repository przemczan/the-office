import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { TestInstanceWebEvent } from "@the-office/contracts";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import {
  TestInstanceCommitRecorded,
  TestInstanceFilesRemoved,
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
  projectId,
  initiativeId,
}: {
  readonly instanceId: string;
  readonly projectId: string;
  readonly initiativeId: string | undefined;
}): WebEventOf<"test-instance.changed"> {
  return {
    type: "test-instance.changed",
    instanceId,
    projectId,
    initiativeId: initiativeId ?? null,
  };
}

/**
 * A launch, a state change, a recorded commit or a build's files removed reaches the web as
 * `test-instance.changed`, so the Initiative's block reads it again; a change to the limits as
 * `test-instance-settings.changed`.
 */
@Injectable()
export class TestInstanceWebEvents implements OnModuleInit {
  constructor(private readonly forwarding: WebEventForwarding) {}

  onModuleInit(): void {
    this.forwarding.forward(TestInstanceLaunched, changed);
    this.forwarding.forward(TestInstanceStateChanged, changed);
    this.forwarding.forward(TestInstanceCommitRecorded, changed);
    this.forwarding.forward(TestInstanceFilesRemoved, changed);
    this.forwarding.forward(
      TestInstanceSettingsChanged,
      (): WebEventOf<"test-instance-settings.changed"> => ({
        type: "test-instance-settings.changed",
      }),
    );
  }
}

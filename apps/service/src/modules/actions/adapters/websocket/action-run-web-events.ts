import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { ActionRunWebEvent } from "@the-office/contracts";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import {
  ActionRunChanged,
  ActionRunStarted,
  ActionRunStateChanged,
  ActionRunsRemoved,
  ActionSettingsChanged,
} from "../../domain/action-run-events.js";

type WebEventOf<Type extends ActionRunWebEvent["type"]> = Omit<
  Extract<ActionRunWebEvent, { type: Type }>,
  "occurredAt"
>;

function changed({
  projectId,
  actionKey,
}: {
  readonly projectId: string;
  readonly actionKey: string;
}): WebEventOf<"action-run.changed"> {
  return { type: "action-run.changed", projectId, actionKey };
}

/**
 * A start, a state change, any other change and a removal reach the web as `action-run.changed`,
 * so the Project's Actions read their runs again; a change to Actions at once as
 * `action-settings.changed`.
 */
@Injectable()
export class ActionRunWebEvents implements OnModuleInit {
  constructor(private readonly forwarding: WebEventForwarding) {}

  onModuleInit(): void {
    this.forwarding.forward(ActionRunStarted, changed);
    this.forwarding.forward(ActionRunStateChanged, changed);
    this.forwarding.forward(ActionRunChanged, changed);
    this.forwarding.forward(ActionRunsRemoved, changed);
    this.forwarding.forward(ActionSettingsChanged, (): WebEventOf<"action-settings.changed"> => ({
      type: "action-settings.changed",
    }));
  }
}

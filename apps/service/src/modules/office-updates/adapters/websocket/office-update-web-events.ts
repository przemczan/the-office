import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { OfficeUpdateWebEvent } from "@the-office/contracts";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import { BusyWorkChanged, ScheduledExitHold } from "../../../busy-work/index.js";
import {
  OfficeRestartScheduled,
  OfficeUpdateChecked,
  OfficeUpdateScheduled,
  ScheduledExitCancelled,
} from "../../domain/office-update-events.js";

const CHANGED: Omit<OfficeUpdateWebEvent, "occurredAt"> = { type: "office-update.changed" };

/**
 * Each change of Settings › Updates reaches the web as one event, which refetches it. The busy work
 * changes with every turn, so it is forwarded only while an update or restart is scheduled and
 * waits for it.
 */
@Injectable()
export class OfficeUpdateWebEvents implements OnModuleInit {
  constructor(
    private readonly forwarding: WebEventForwarding,
    private readonly hold: ScheduledExitHold,
  ) {}

  onModuleInit(): void {
    for (const event of [
      OfficeUpdateChecked,
      OfficeUpdateScheduled,
      OfficeRestartScheduled,
      ScheduledExitCancelled,
    ]) {
      this.forwarding.forward(event, () => CHANGED);
    }
    this.forwarding.forward(BusyWorkChanged, () => (this.hold.isScheduled() ? CHANGED : undefined));
  }
}

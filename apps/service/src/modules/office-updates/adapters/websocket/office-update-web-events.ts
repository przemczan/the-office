import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { OfficeUpdateWebEvent } from "@the-office/contracts";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import { OfficeUpdateHold } from "../../application/office-update-hold.js";
import {
  BusyWorkChanged,
  OfficeUpdateCancelled,
  OfficeUpdateChecked,
  OfficeUpdateScheduled,
} from "../../domain/office-update-events.js";

const CHANGED: Omit<OfficeUpdateWebEvent, "occurredAt"> = { type: "office-update.changed" };

/**
 * Each change of Settings › Updates reaches the web as one event, which refetches it. The busy work
 * changes with every turn, so it is forwarded only while an update is scheduled and waits for it.
 */
@Injectable()
export class OfficeUpdateWebEvents implements OnModuleInit {
  constructor(
    private readonly forwarding: WebEventForwarding,
    private readonly hold: OfficeUpdateHold,
  ) {}

  onModuleInit(): void {
    for (const event of [OfficeUpdateChecked, OfficeUpdateScheduled, OfficeUpdateCancelled]) {
      this.forwarding.forward(event, () => CHANGED);
    }
    this.forwarding.forward(BusyWorkChanged, () => (this.hold.isScheduled() ? CHANGED : undefined));
  }
}

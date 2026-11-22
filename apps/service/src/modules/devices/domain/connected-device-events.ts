import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { ConnectedDeviceState } from "./connected-device.js";

/** A Task's Connected device was connected, changed its state, or was disconnected. */
export class ConnectedDeviceChanged extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly deviceId: string,
    /** The Project device it was lent from, so its holder's changes reach it; null for none. */
    readonly projectDeviceId: string | null = null,
    /** Its state after the change; null when the publisher didn't say. */
    readonly state: ConnectedDeviceState | null = null,
  ) {
    super();
  }
}

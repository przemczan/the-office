import { DomainEvent } from "../../../platform/events/domain-event.js";

/** A Task's Connected device was connected, changed its state, or was disconnected. */
export class ConnectedDeviceChanged extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly deviceId: string,
  ) {
    super();
  }
}

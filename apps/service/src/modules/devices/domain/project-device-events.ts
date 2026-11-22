import { DomainEvent } from "../../../platform/events/domain-event.js";

/**
 * A Project's device was added, renamed, given a new Port, paired, lent, let go of or removed, so
 * the Project's Devices section reads them again.
 */
export class ProjectDeviceChanged extends DomainEvent {
  constructor(
    readonly projectId: string,
    readonly deviceId: string,
  ) {
    super();
  }
}

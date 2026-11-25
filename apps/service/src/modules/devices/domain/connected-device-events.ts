import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { ConnectedDeviceState, RunHolder } from "./connected-device.js";

/**
 * A Connected device was connected, changed its state, or was disconnected: a Task's, or a run's
 * hold of a Project device, so the run (an Action run, a test instance) learns its hold ended.
 */
export class ConnectedDeviceChanged extends DomainEvent {
  constructor(
    /** The Task it is connected to; null for a run's hold. */
    readonly taskId: string | null,
    readonly deviceId: string,
    /** The Project device it was lent from, so its holder's changes reach it; null for none. */
    readonly projectDeviceId: string | null = null,
    /** Its state after the change; null when the publisher didn't say. */
    readonly state: ConnectedDeviceState | null = null,
    /** The Action run or test instance holding the Project device; null for a Task's device. */
    readonly runHolder: RunHolder | null = null,
    /** The tab that relays a run's device over USB, which opens it while Connecting; else null. */
    readonly relayTab: string | null = null,
  ) {
    super();
  }
}

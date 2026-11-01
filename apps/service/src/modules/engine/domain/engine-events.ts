import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { UsageWindows } from "./usage-windows.js";

/** The account's usage windows changed, as read after the engine signalled a rate limit (spec §5.4). */
export class UsageWindowsChanged extends DomainEvent {
  constructor(readonly windows: UsageWindows) {
    super();
  }
}

/**
 * The account's usage windows were read, changed or not: each reading tells what The Office used
 * of them since, so what was expected of the Starts before it is known now (spec §2.1).
 */
export class UsageWindowsRead extends DomainEvent {
  constructor(
    readonly windows: UsageWindows,
    readonly readAt: Date,
  ) {
    super();
  }
}

/** The engine could not start a session, or stopped running one: its program didn't start or its stream died. */
export class EngineDown extends DomainEvent {
  constructor(
    readonly sessionId: string,
    /** In the engine's words. */
    readonly reason: string,
  ) {
    super();
  }
}

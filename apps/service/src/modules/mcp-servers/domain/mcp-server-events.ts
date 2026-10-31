import { DomainEvent } from "../../../platform/events/domain-event.js";

// The events name the server and never carry it: its Server values may hold secrets.

/** It arrives off, waiting for review. */
export class McpServerAdded extends DomainEvent {
  constructor(
    readonly serverName: string,
    addedAt: Date,
  ) {
    super(addedAt);
  }
}

/** Its command or URL, or its Server values, changed; a change that needs a review turned it off. */
export class McpServerChanged extends DomainEvent {
  constructor(
    readonly serverName: string,
    readonly turnedOff: boolean,
  ) {
    super();
  }
}

export class McpServerRemoved extends DomainEvent {
  constructor(readonly serverName: string) {
    super();
  }
}

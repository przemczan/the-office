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

/** Reviewed and turned on, its tools as the review listed them. */
export class McpServerTurnedOn extends DomainEvent {
  constructor(readonly serverName: string) {
    super();
  }
}

/** Turned off by the user; a change that needs a review is McpServerChanged's `turnedOff`. */
export class McpServerTurnedOff extends DomainEvent {
  constructor(readonly serverName: string) {
    super();
  }
}

/** The Roles it is assigned to changed; their running sessions keep the servers they started with. */
export class McpServerRolesChanged extends DomainEvent {
  constructor(readonly serverName: string) {
    super();
  }
}

export class McpServerRemoved extends DomainEvent {
  constructor(readonly serverName: string) {
    super();
  }
}

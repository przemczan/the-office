import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { Idea } from "./idea.js";

export class IdeaCaptured extends DomainEvent {
  constructor(readonly idea: Idea) {
    super(idea.capturedAt);
  }
}

/** The Task it was shaped into names it as its origin and takes its Attachments. */
export class IdeaShaped extends DomainEvent {
  constructor(
    readonly ideaId: string,
    readonly projectId: string,
    readonly taskId: string,
    at: Date,
  ) {
    super(at);
  }
}

export class IdeaDropped extends DomainEvent {
  constructor(
    readonly ideaId: string,
    at: Date,
  ) {
    super(at);
  }
}

/** A dropped Idea back among the new ones. */
export class IdeaRestored extends DomainEvent {
  constructor(readonly ideaId: string) {
    super();
  }
}

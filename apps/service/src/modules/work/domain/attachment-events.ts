import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { Attachment, AttachmentOwner } from "./attachment.js";

export class AttachmentAdded extends DomainEvent {
  constructor(readonly attachment: Attachment) {
    super(attachment.addedAt);
  }
}

/**
 * An Agent attached a new copy of the file in its place (spec §2.1): its id, owner and `addedAt`
 * are as they were, so it is announced as it happens.
 */
export class AttachmentReplaced extends DomainEvent {
  constructor(readonly attachment: Attachment) {
    super();
  }
}

/** Moved with its Idea into the Task the Idea was shaped into. */
export class AttachmentMoved extends DomainEvent {
  constructor(
    readonly attachmentId: string,
    readonly from: AttachmentOwner,
    readonly to: AttachmentOwner,
  ) {
    super();
  }
}

export class AttachmentRemoved extends DomainEvent {
  constructor(
    readonly attachmentId: string,
    readonly owner: AttachmentOwner,
  ) {
    super();
  }
}

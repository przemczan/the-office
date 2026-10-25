import type { DomainEvent } from "../../../platform/events/domain-event.js";
import {
  newFileProblems,
  newLinkProblems,
  storedFileKind,
  trimmedNewLink,
  type Attachment,
  type AttachmentOwner,
  type NewFile,
  type NewLink,
} from "./attachment.js";
import { AttachmentAdded, AttachmentMoved, AttachmentRemoved } from "./attachment-events.js";
import { AttachmentRefused } from "./attachment-refused.js";
import type { Author } from "./author.js";

/** An Attachment after a change, with the event that announces it. */
export interface AttachmentChange<Event extends DomainEvent> {
  readonly attachment: Attachment;
  readonly event: Event;
}

/** Who adds an Attachment to what, and when. */
export interface Adding {
  readonly owner: AttachmentOwner;
  readonly addedBy: Author;
  readonly addedAt: Date;
}

/** Refuses with every reason. That the owner may take it is checked by the caller. */
export function addLink(
  id: string,
  given: NewLink,
  adding: Adding,
): AttachmentChange<AttachmentAdded> {
  const link = trimmedNewLink(given);
  const problems = newLinkProblems(link);
  if (problems.length > 0) throw new AttachmentRefused(problems);
  const attachment: Attachment = { id, kind: "link", ...link, ...adding };
  return { attachment, event: new AttachmentAdded(attachment) };
}

/** Refuses with every reason; the file's kind follows from its name and media type. */
export function addFile(
  id: string,
  given: NewFile,
  adding: Adding,
): AttachmentChange<AttachmentAdded> {
  const file = { ...given, name: given.name.trim() };
  const problems = newFileProblems(file);
  if (problems.length > 0) throw new AttachmentRefused(problems);
  const attachment: Attachment = { id, kind: storedFileKind(file), ...file, ...adding };
  return { attachment, event: new AttachmentAdded(attachment) };
}

export function moveAttachment(
  attachment: Attachment,
  to: AttachmentOwner,
): AttachmentChange<AttachmentMoved> {
  return {
    attachment: { ...attachment, owner: to },
    event: new AttachmentMoved(attachment.id, attachment.owner, to),
  };
}

export function removeAttachment(attachment: Attachment): AttachmentRemoved {
  return new AttachmentRemoved(attachment.id, attachment.owner);
}

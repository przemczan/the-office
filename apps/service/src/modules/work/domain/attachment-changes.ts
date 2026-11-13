import type { DomainEvent } from "../../../platform/events/domain-event.js";
import {
  isTextFile,
  newFileProblems,
  newLinkProblems,
  storedFileKind,
  trimmedNewLink,
  type Attachment,
  type AttachmentOwner,
  type NewFile,
  type NewLink,
  type StoredFileAttachment,
} from "./attachment.js";
import {
  AttachmentAdded,
  AttachmentMoved,
  AttachmentRemoved,
  AttachmentReplaced,
} from "./attachment-events.js";
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

/**
 * Refuses with every reason; the file's kind follows from its name and media type, and a document
 * is a text file whatever its bytes.
 */
export function addFile(
  id: string,
  given: NewFile,
  adding: Adding,
): AttachmentChange<AttachmentAdded> & { readonly attachment: StoredFileAttachment } {
  const file = { ...given, name: given.name.trim() };
  const problems = newFileProblems(file);
  if (problems.length > 0) throw new AttachmentRefused(problems);
  const kind = storedFileKind(file);
  const attachment: StoredFileAttachment = {
    id,
    ...file,
    kind,
    text: isTextFile({ ...file, kind }, file.text),
    ...adding,
  };
  return { attachment, event: new AttachmentAdded(attachment) };
}

/**
 * The Attachment a file an Agent attaches to a Task from `sourcePath` in its worktree replaces
 * (spec §2.1, the user's answer of 2026-11-13): the one an Agent attached from the same path to the
 * same Task since the user last acted at a Gate on it, whose run ended at `lastActedOnGateEnd`
 * (undefined before any). Never a link, anything the user attached, or anything on an Idea or an
 * Initiative, so what a Gate already showed the user stays as it was.
 */
export function attachmentToReplace(
  attachments: readonly Attachment[],
  adding: Adding,
  sourcePath: string,
  lastActedOnGateEnd: Date | undefined,
): StoredFileAttachment | undefined {
  const { owner, addedBy } = adding;
  if (owner.kind !== "task" || addedBy.kind !== "person") return undefined;
  return attachments
    .filter(
      (attachment): attachment is StoredFileAttachment =>
        attachment.kind !== "link" &&
        attachment.owner.kind === "task" &&
        attachment.owner.taskId === owner.taskId &&
        attachment.addedBy.kind === "person" &&
        attachment.sourcePath === sourcePath &&
        (lastActedOnGateEnd === undefined || attachment.addedAt > lastActedOnGateEnd),
    )
    .at(-1);
}

/**
 * The new copy in `replaced`'s place: its id, owner and `addedAt` kept, so whatever names it and
 * the round showing it stay; the rest is the new file's, refused as `addFile` refuses it.
 */
export function replaceFile(
  replaced: StoredFileAttachment,
  given: NewFile,
  addedBy: Author,
): AttachmentChange<AttachmentReplaced> & { readonly attachment: StoredFileAttachment } {
  const { attachment } = addFile(replaced.id, given, {
    owner: replaced.owner,
    addedBy,
    addedAt: replaced.addedAt,
  });
  return { attachment, event: new AttachmentReplaced(attachment) };
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

import type { Attachment, AttachmentOwner, NewLink } from "@the-office/contracts";
import { addFile, addLink } from "../../api/work.ts";

/** An Attachment the user chose, before it is added to its Idea or Task. */
export type PendingAttachment =
  | { readonly kind: "file"; readonly file: File }
  | { readonly kind: "link"; readonly link: NewLink };

export function attach(owner: AttachmentOwner, pending: PendingAttachment): Promise<Attachment> {
  return pending.kind === "file" ? addFile(owner, pending.file) : addLink(owner, pending.link);
}

/**
 * Adds each to `owner` one at a time and in order, so they list as they were chosen, calling
 * `onAttached` as each is added. Stops at the first that can't be added, leaving the rest.
 */
export async function attachAll(
  owner: AttachmentOwner,
  pending: readonly PendingAttachment[],
  onAttached: (attachment: Attachment) => void = () => {},
): Promise<readonly Attachment[]> {
  const attached: Attachment[] = [];
  for (const attachment of pending) {
    const added = await attach(owner, attachment);
    attached.push(added);
    onAttached(added);
  }
  return attached;
}

/** What the pending Attachment is called: the file's name, or the link's name or address. */
export function pendingName(pending: PendingAttachment): string {
  if (pending.kind === "file") return pending.file.name;
  return pending.link.name.trim() || pending.link.url.trim();
}

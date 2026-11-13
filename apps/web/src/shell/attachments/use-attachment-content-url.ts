import { useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { attachmentCopiesOf } from "../../api/attachment-copies.ts";
import { attachmentContentUrl } from "../../api/work.ts";

/**
 * A file Attachment's content URL at the copy the page shows, changing when an Agent replaces it,
 * so an image or a frame showing it loads the new copy.
 */
export function useAttachmentContentUrl(attachmentId: string): string {
  const copies = attachmentCopiesOf(useQueryClient());
  const copy = useSyncExternalStore(copies.subscribe, () => copies.copyOf(attachmentId));
  return attachmentContentUrl(attachmentId, copy);
}

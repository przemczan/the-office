import type { QueryClient } from "@tanstack/react-query";

/**
 * Which copy of each Attachment's file the page shows: how many times an Agent replaced it since
 * the page opened (`attachment.replaced`), 0 for one never replaced. The content URL names the
 * copy, as an open image or HTML preview reads its address only once and a new copy keeps the id.
 */
export class AttachmentCopies {
  private readonly copies = new Map<string, number>();
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  copyOf(attachmentId: string): number {
    return this.copies.get(attachmentId) ?? 0;
  }

  replaced(attachmentId: string): void {
    this.copies.set(attachmentId, this.copyOf(attachmentId) + 1);
    for (const listener of this.listeners) listener();
  }
}

const copiesByClient = new WeakMap<QueryClient, AttachmentCopies>();

/** One per query client, so the page's events and its parts share it and each test has its own. */
export function attachmentCopiesOf(queryClient: QueryClient): AttachmentCopies {
  let copies = copiesByClient.get(queryClient);
  if (copies === undefined) {
    copies = new AttachmentCopies();
    copiesByClient.set(queryClient, copies);
  }
  return copies;
}

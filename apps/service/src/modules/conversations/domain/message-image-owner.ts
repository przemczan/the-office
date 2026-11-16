import type { Thread } from "./thread.js";

/**
 * What keeps the images the user sends in a Thread's messages, as an Attachment's owner: the
 * Thread's Task or Initiative, or the Thread itself when it is on neither.
 */
export type MessageImageOwner =
  | { readonly kind: "task"; readonly taskId: string }
  | { readonly kind: "initiative"; readonly initiativeId: string }
  | { readonly kind: "thread"; readonly threadId: string };

/**
 * Where a Thread's images are kept: on its Task (a person's Thread, a Stage Thread or a
 * Consultation there) or its Initiative, as anything about them is; on the Thread itself in a chat,
 * a Consultation in a chat included.
 */
export function imageOwnerOf({ id, home }: Thread): MessageImageOwner {
  switch (home.kind) {
    case "task":
      return { kind: "task", taskId: home.taskId };
    case "initiative":
      return { kind: "initiative", initiativeId: home.initiativeId };
    case "chat":
      return { kind: "thread", threadId: id };
  }
}

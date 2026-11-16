import {
  messageImageProblem,
  messageImagesProblem,
  SKILL_COMMAND_IMAGES_PROBLEM,
} from "@the-office/contracts";
import { useRef, useState } from "react";
import { uploadMessageImage } from "../../api/conversations.ts";

/** An image pasted or dropped into a message box, before its message is sent. */
export interface PendingMessageImage {
  /** Its own key in the box, as two pastes may carry files of one name. */
  readonly key: string;
  readonly file: File;
  /** The rule it breaks on its own, in the user's words; null when it keeps them. */
  readonly problem: string | null;
}

/**
 * Uploads the box's images to the Thread, those not uploaded yet, and answers every one's Attachment
 * id in order; none when the box has none.
 */
export type UploadMessageImages = (threadId: string) => Promise<string[]>;

export interface MessageImages {
  readonly pending: readonly PendingMessageImage[];
  /** Every rule broken now, each once, in the order the user reads them; none when Send may go. */
  readonly problems: readonly string[];
  readonly add: (files: readonly File[]) => void;
  readonly remove: (key: string) => void;
  /** Takes out the images a message carried once it is sent (`key`s), leaving any added since. */
  readonly removeSent: (keys: readonly string[]) => void;
  readonly upload: UploadMessageImages;
}

/**
 * The images a message box holds until Send (spec §2.4), and the rules they keep, checked here
 * before anything uploads: each image's kind and size, how many and how large together, and none
 * with a skill command (`skillCommand`). An image uploaded once keeps its Attachment id, so sending
 * again after a refusal reuses it rather than uploading it again.
 */
export function useMessageImages(skillCommand: boolean): MessageImages {
  const [pending, setPending] = useState<readonly PendingMessageImage[]>([]);
  // Kept outside the state: an upload finishing mustn't redraw the box, and a retry reads it at once.
  const uploaded = useRef(new Map<string, { readonly threadId: string; readonly id: string }>());
  const nextKey = useRef(0);
  const add = (files: readonly File[]): void => {
    if (files.length === 0) return;
    setPending((current) => [
      ...current,
      ...files.map((file) => {
        nextKey.current += 1;
        return {
          key: `image-${nextKey.current}`,
          file,
          problem: messageImageProblem({ name: file.name, mediaType: file.type, size: file.size }),
        };
      }),
    ]);
  };
  const remove = (key: string): void => {
    uploaded.current.delete(key);
    setPending((current) => current.filter((image) => image.key !== key));
  };
  const removeSent = (keys: readonly string[]): void => {
    const sent = new Set(keys);
    for (const key of sent) uploaded.current.delete(key);
    setPending((current) => current.filter((image) => !sent.has(image.key)));
  };
  const upload: UploadMessageImages = async (threadId) => {
    const ids: string[] = [];
    // One at a time and in order, so the message carries them as they were added.
    for (const image of pending) {
      const done = uploaded.current.get(image.key);
      if (done?.threadId === threadId) {
        ids.push(done.id);
        continue;
      }
      const { attachmentId } = await uploadMessageImage(threadId, image.file);
      uploaded.current.set(image.key, { threadId, id: attachmentId });
      ids.push(attachmentId);
    }
    return ids;
  };
  return {
    pending,
    problems: messageImageProblems(pending, skillCommand),
    add,
    remove,
    removeSent,
    upload,
  };
}

/** The rules the images break, each image's first, then the message's, then the skill command's. */
export function messageImageProblems(
  pending: readonly PendingMessageImage[],
  skillCommand: boolean,
): readonly string[] {
  const problems = pending.flatMap(({ problem }) => (problem === null ? [] : [problem]));
  const together = messageImagesProblem(pending.map(({ file }) => file));
  if (together !== null) problems.push(together);
  if (skillCommand && pending.length > 0) problems.push(SKILL_COMMAND_IMAGES_PROBLEM);
  return [...new Set(problems)];
}

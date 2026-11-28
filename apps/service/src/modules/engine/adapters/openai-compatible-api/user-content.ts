import type { MessageImageContent } from "../../ports/engine-session.js";
import { unseenImageLine } from "../shared/unseen-image-line.js";
import type { UserContentPart, UserMessage } from "./chat-completions.js";

/**
 * A user message's content with its images: on a model that sees images, its text then each image
 * as a data URL part; on one that doesn't, the text alone, with a line naming each image so the
 * model knows it was sent and that it can't see it. A message without images stays plain text.
 */
export function userContent(
  text: string,
  images: readonly MessageImageContent[],
  seesImages: boolean,
): UserMessage["content"] {
  if (images.length === 0) return text;
  // A message of images alone, from the same user as the one before, has no text.
  const words = text === "" ? [] : [text];
  if (!seesImages) return [...words, ...images.map(unseenImageLine)].join("\n\n");
  return [
    ...words.map((line): UserContentPart => ({ type: "text", text: line })),
    ...images.map((image): UserContentPart => ({
      type: "image_url",
      image_url: {
        url: `data:${image.mediaType};base64,${Buffer.from(image.content).toString("base64")}`,
      },
    })),
  ];
}

/** Two user messages' contents as one, the second after a blank line. */
export function joinedContent(
  first: UserMessage["content"],
  second: UserMessage["content"],
): UserMessage["content"] {
  if (typeof first === "string" && typeof second === "string") return `${first}\n\n${second}`;
  return [...partsOf(first), { type: "text", text: "\n\n" }, ...partsOf(second)];
}

function partsOf(content: UserMessage["content"]): readonly UserContentPart[] {
  return typeof content === "string" ? [{ type: "text", text: content }] : content;
}

/**
 * About how many tokens an image takes in a request, for a server that counts none: a large
 * screenshot is about this much on most vision models.
 */
export const ESTIMATED_IMAGE_TOKENS = 1_500;

/** A data URL's bytes left out, for estimating a request's length by its text. */
export function withoutImageData(key: string, value: unknown): unknown {
  return key === "url" && typeof value === "string" && value.startsWith("data:") ? "" : value;
}

/** How many image parts `messages` hold. */
export function imageCount(messages: readonly { readonly content: unknown }[]): number {
  return messages.reduce(
    (count, { content }) =>
      count +
      (Array.isArray(content)
        ? content.filter((part: UserContentPart) => part.type === "image_url").length
        : 0),
    0,
  );
}

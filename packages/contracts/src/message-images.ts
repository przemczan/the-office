import { z } from "zod";

/**
 * The kinds of picture the user may paste or drop into a Thread's message box. SVG is left out:
 * an engine doesn't read it as a picture, and it can carry script.
 */
export const MESSAGE_IMAGE_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;
export type MessageImageMediaType = (typeof MESSAGE_IMAGE_MEDIA_TYPES)[number];

/** The most one image in a message may be: the most a Claude Code engine shows as a picture. */
export const MESSAGE_IMAGE_BYTES = 3 * 1024 * 1024;
/** The most images one message may carry. */
export const MESSAGE_IMAGES_PER_MESSAGE = 10;
/**
 * The most a message's images may be together, so the request carrying them, about a third
 * larger once encoded, stays well under the model API's limit with the history beside it.
 */
export const MESSAGE_IMAGES_TOTAL_BYTES = 15 * 1024 * 1024;

export function isMessageImageMediaType(mediaType: string): mediaType is MessageImageMediaType {
  return (MESSAGE_IMAGE_MEDIA_TYPES as readonly string[]).includes(
    mediaType.split(";")[0]?.trim().toLowerCase() ?? "",
  );
}

/** The rule an image breaks, in words the user reads; null when it keeps them all. */
export function messageImageProblem(image: {
  readonly name: string;
  readonly mediaType: string;
  readonly size: number;
}): string | null {
  if (!isMessageImageMediaType(image.mediaType)) {
    return `${image.name || "This file"} isn't an image the message can carry: only PNG, JPEG, GIF and WebP are.`;
  }
  if (image.size > MESSAGE_IMAGE_BYTES) {
    return `${image.name || "This image"} is larger than ${megabytes(MESSAGE_IMAGE_BYTES)}, the most one image may be.`;
  }
  return null;
}

/** The rule a message's images break together, in words the user reads; null when they keep them. */
export function messageImagesProblem(images: readonly { readonly size: number }[]): string | null {
  if (images.length > MESSAGE_IMAGES_PER_MESSAGE) {
    return `A message carries at most ${MESSAGE_IMAGES_PER_MESSAGE} images.`;
  }
  const total = images.reduce((sum, image) => sum + image.size, 0);
  if (total > MESSAGE_IMAGES_TOTAL_BYTES) {
    return `A message's images may be at most ${megabytes(MESSAGE_IMAGES_TOTAL_BYTES)} together.`;
  }
  return null;
}

/** The words for a skill command sent with images. */
export const SKILL_COMMAND_IMAGES_PROBLEM =
  "A skill command carries no images: send them in a message of their own.";

function megabytes(bytes: number): string {
  return `${bytes / (1024 * 1024)} MB`;
}

/** An image a user message carries, as it was when the message was sent. */
export const messageImageSchema = z.object({
  attachmentId: z.uuid(),
  name: z.string(),
  mediaType: z.string(),
});
export type MessageImage = z.infer<typeof messageImageSchema>;

/**
 * The query of POST /threads/:id/images, whose body is the image itself as
 * `application/octet-stream`, typed by its bytes; it answers the stored image as a `MessageImage`.
 */
export const messageImageUploadQuerySchema = z.object({
  fileName: z.string().min(1),
});
export type MessageImageUploadQuery = z.infer<typeof messageImageUploadQuerySchema>;

import { z } from "zod";

/** The most an image The Office keeps may be; the service and the web both hold to it. */
export const IMAGE_UPLOAD_BYTES = 2 * 1024 * 1024;

export const IMAGE_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
] as const;

/** A picture kept by The Office; each upload or choice is a new image under a new id, its bytes never changing. */
export const imageSchema = z.object({
  id: z.string(),
  mediaType: z.enum(IMAGE_MEDIA_TYPES),
});
export type Image = z.infer<typeof imageSchema>;

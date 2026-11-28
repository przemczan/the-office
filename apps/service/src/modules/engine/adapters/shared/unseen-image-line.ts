import type { MessageImageContent } from "../../ports/engine-session.js";

/** The line that stands for an image the model can't see. */
export function unseenImageLine({ name, attachmentId }: MessageImageContent): string {
  return `[Image ${name}, Attachment ${attachmentId}: this model can't see pictures; read_attachment gives its name and size only.]`;
}

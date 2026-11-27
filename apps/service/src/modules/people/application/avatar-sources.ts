import { Injectable } from "@nestjs/common";
import type { AvatarSource } from "../ports/avatar-source.js";

/**
 * Where the module keeping Attachments gives People an Attachment's bytes, for an Avatar set from
 * one. That module calls People, so it registers here as it starts instead of being called
 * through a port.
 */
@Injectable()
export class AvatarSources implements AvatarSource {
  private source: AvatarSource | undefined;

  provide(source: AvatarSource): void {
    if (this.source) throw new Error("Attachments' bytes come from one module only.");
    this.source = source;
  }

  async contentOf(attachmentId: string): Promise<Uint8Array> {
    if (!this.source) throw new Error("No module gives Attachments' bytes.");
    return this.source.contentOf(attachmentId);
  }
}

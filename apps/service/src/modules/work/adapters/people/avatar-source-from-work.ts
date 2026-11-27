import { Injectable, type OnModuleInit } from "@nestjs/common";
import { AvatarSources, RoleRefused, type AvatarSource } from "../../../people/index.js";
import { AttachmentService } from "../../application/attachment-service.js";
import { AttachmentNotFound } from "../../domain/attachment-not-found.js";
import { AttachmentRefused } from "../../domain/attachment-refused.js";

/**
 * Gives People the bytes of an Attachment, for an Avatar set from one. People judges them as it
 * does an upload's; an Agent never sees the picture.
 */
@Injectable()
export class AvatarSourceFromWork implements AvatarSource, OnModuleInit {
  constructor(
    private readonly sources: AvatarSources,
    private readonly attachments: AttachmentService,
  ) {}

  onModuleInit(): void {
    this.sources.provide(this);
  }

  async contentOf(attachmentId: string): Promise<Uint8Array> {
    try {
      return await this.attachments.contentOf(attachmentId);
    } catch (error) {
      if (error instanceof AttachmentNotFound || error instanceof AttachmentRefused) {
        throw new RoleRefused([error.message]);
      }
      throw error;
    }
  }
}

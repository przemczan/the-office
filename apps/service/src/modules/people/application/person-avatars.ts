import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { Injectable, Logger } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { readImage } from "../../../platform/images/image-rules.js";
import { AvatarNotFound, type Avatar } from "../domain/avatar.js";
import { changeAvatar } from "../domain/role-changes.js";
import { RoleNotFound } from "../domain/role-not-found.js";
import { RoleRefused } from "../domain/role-refused.js";
import { AvatarFiles } from "../ports/avatar-files.js";
import { RoleRepository } from "../ports/role-repository.js";

export interface OpenedAvatar {
  readonly avatar: Avatar;
  readonly content: Readable;
}

/**
 * People's Avatars. A file is written before the row names it and removed after the row stops
 * naming it, so a person never names a file that isn't there.
 */
@Injectable()
export class PersonAvatars {
  private readonly logger = new Logger(PersonAvatars.name);

  constructor(
    private readonly repository: RoleRepository,
    private readonly files: AvatarFiles,
    private readonly events: EventBus,
  ) {}

  /** Refuses, keeping the Avatar the person has, bytes that can't be an image. */
  async change(roleKey: string, content: Uint8Array): Promise<void> {
    const reading = readImage(content);
    if ("problem" in reading) throw new RoleRefused([reading.problem]);
    const avatar: Avatar = { id: randomUUID(), mediaType: reading.mediaType };
    await this.files.save(avatar.id, content);
    try {
      await this.keep(roleKey, avatar);
    } catch (error) {
      await this.files.remove(avatar.id);
      throw error;
    }
  }

  async remove(roleKey: string): Promise<void> {
    await this.keep(roleKey, null);
  }

  /** Answers only for the Avatar the person holds now; one they held before is gone. */
  async open(roleKey: string, imageId: string): Promise<OpenedAvatar> {
    const role = await this.repository.find(roleKey);
    if (!role) throw new RoleNotFound(roleKey);
    if (role.avatar?.id !== imageId) throw new AvatarNotFound(roleKey, imageId);
    return { avatar: role.avatar, content: await this.files.open(imageId) };
  }

  private async keep(roleKey: string, avatar: Avatar | null): Promise<void> {
    let replaced: Avatar | null | undefined;
    const { event } = await this.repository.changeAvatar(roleKey, (current) => {
      replaced = current.avatar;
      return changeAvatar(current, avatar, new Date());
    });
    if (event) await this.events.publish(event);
    if (replaced) await this.removeReplaced(replaced);
  }

  /** The change is kept by now, so a file left behind doesn't fail it. */
  private async removeReplaced(avatar: Avatar): Promise<void> {
    try {
      await this.files.remove(avatar.id);
    } catch (error) {
      this.logger.warn(`Could not remove Avatar ${avatar.id}: ${(error as Error).message}`);
    }
  }
}

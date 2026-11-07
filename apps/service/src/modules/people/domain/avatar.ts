export type AvatarMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml";

/**
 * A person's own picture, kept by The Office. Its bytes never change: each upload is a new Avatar
 * under a new id, so its address can be cached for good.
 */
export interface Avatar {
  readonly id: string;
  readonly mediaType: AvatarMediaType;
}

export class AvatarNotFound extends Error {
  constructor(
    readonly roleKey: string,
    readonly imageId: string,
  ) {
    super(`The person in the Role "${roleKey}" has no Avatar "${imageId}".`);
    this.name = "AvatarNotFound";
  }
}

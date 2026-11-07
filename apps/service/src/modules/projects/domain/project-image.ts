/** The two images a Project can show in place of its mark (spec §2.1). */
export const PROJECT_IMAGE_KEYS = ["icon", "logo"] as const;
export type ProjectImageKey = (typeof PROJECT_IMAGE_KEYS)[number];

export type ProjectImageMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml";

/**
 * A picture kept by The Office, uploaded or copied from the repository. Its bytes never change: each
 * is a new image under a new id, so its address can be cached for good.
 */
export interface ProjectImage {
  readonly id: string;
  readonly mediaType: ProjectImageMediaType;
}

export class ProjectImageNotFound extends Error {
  constructor(
    readonly projectId: string,
    readonly imageId: string,
  ) {
    super(`The Project "${projectId}" has no image "${imageId}".`);
    this.name = "ProjectImageNotFound";
  }
}

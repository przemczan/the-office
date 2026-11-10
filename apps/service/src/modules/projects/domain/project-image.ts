/** The two images a Project can show in place of its mark (spec §2.1). */
export const PROJECT_IMAGE_KEYS = ["icon", "logo"] as const;
export type ProjectImageKey = (typeof PROJECT_IMAGE_KEYS)[number];

/** The palettes an image has a version for: the one for the palette shown is used (spec §2.1). */
export const PROJECT_IMAGE_PALETTES = ["light", "dark"] as const;
export type ProjectImagePalette = (typeof PROJECT_IMAGE_PALETTES)[number];

export type ProjectImageMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml";

/**
 * A picture kept by The Office, uploaded or copied from the repository. Its bytes never change: each
 * is a new image under a new id, so its address can be cached for good.
 */
export interface ProjectImage {
  readonly id: string;
  readonly mediaType: ProjectImageMediaType;
}

/** An Icon or a Logo, each version null when the Project holds none. */
export type ProjectImageVersions = Readonly<Record<ProjectImagePalette, ProjectImage | null>>;

export const NO_PROJECT_IMAGE: ProjectImageVersions = { light: null, dark: null };

export class ProjectImageNotFound extends Error {
  constructor(
    readonly projectId: string,
    readonly imageId: string,
  ) {
    super(`The Project "${projectId}" has no image "${imageId}".`);
    this.name = "ProjectImageNotFound";
  }
}

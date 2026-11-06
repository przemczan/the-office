import type { ProjectImage } from "@the-office/contracts";
import { useState } from "react";
import { projectImageAddress } from "../api/projects.ts";

interface ShownProjectImage {
  /** Undefined when there is no image to show, or it couldn't be loaded: draw the fallback. */
  readonly address: string | undefined;
  readonly onError: () => void;
}

/** A Project's Icon or Logo until it fails to load; another image, under its own id, gets a try. */
export function useShownProjectImage(
  projectId: string | undefined,
  image: ProjectImage | null | undefined,
): ShownProjectImage {
  const [failedImageId, setFailedImageId] = useState<string>();
  const shown = projectId !== undefined && image && image.id !== failedImageId;
  return {
    address: shown ? projectImageAddress(projectId, image.id) : undefined,
    onError: () => setFailedImageId(image?.id),
  };
}

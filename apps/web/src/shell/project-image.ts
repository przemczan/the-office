import type { Image } from "@the-office/contracts";
import { projectImageAddress } from "../api/projects.ts";
import { useShownImage, type ShownImage } from "./shown-image.ts";

/** A Project's Icon or Logo until it fails to load; another image, under its own id, gets a try. */
export function useShownProjectImage(
  projectId: string | undefined,
  image: Image | null | undefined,
): ShownImage {
  return useShownImage(
    projectId !== undefined && image ? projectImageAddress(projectId, image.id) : undefined,
  );
}

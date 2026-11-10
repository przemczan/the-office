import {
  projectImagePaletteSchema,
  type Image,
  type ProjectImagePalette,
  type ProjectImageVersions,
} from "@the-office/contracts";
import { useAppearance } from "@the-office/ui";
import { useState } from "react";
import { projectImageAddress } from "../api/projects.ts";
import type { ShownImage } from "./shown-image.ts";

/**
 * The versions an Icon or a Logo takes: one for each base, light and dark, whichever palette over
 * it is shown.
 */
export const IMAGE_PALETTES = projectImagePaletteSchema.options;

export function otherPalette(palette: ProjectImagePalette): ProjectImagePalette {
  return palette === "light" ? "dark" : "light";
}

/** The versions of an Icon or a Logo worth a try: the palette's own first, then the other one. */
export function versionsToTry(
  versions: ProjectImageVersions,
  palette: ProjectImagePalette,
): readonly Image[] {
  return [versions[palette], versions[otherPalette(palette)]].filter((image) => image !== null);
}

/**
 * A Project's Icon or Logo in the version for the base of the palette shown (Graphite shows the
 * dark one, Paper the light one), or for `palette` when given. The
 * other version shows when that one is missing or fails to load, and none once both have failed;
 * another image, under its own id, gets a try.
 */
export function useShownProjectImage(
  projectId: string | undefined,
  versions: ProjectImageVersions | undefined,
  palette?: ProjectImagePalette,
): ShownImage {
  const shownBase = useAppearance().base;
  const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(new Set());
  const image =
    versions && versionsToTry(versions, palette ?? shownBase).find(({ id }) => !failedIds.has(id));
  if (projectId === undefined || image === undefined)
    return { address: undefined, onError: () => {} };
  return {
    address: projectImageAddress(projectId, image.id),
    onError: () => setFailedIds((failed) => new Set(failed).add(image.id)),
  };
}

import type { Image, ProjectImageVersions } from "@the-office/contracts";
import { useAppearance, type Palette } from "@the-office/ui";
import { useState } from "react";
import { projectImageAddress } from "../api/projects.ts";
import type { ShownImage } from "./shown-image.ts";

export function otherPalette(palette: Palette): Palette {
  return palette === "light" ? "dark" : "light";
}

/** The versions of an Icon or a Logo worth a try: the palette's own first, then the other one. */
export function versionsToTry(versions: ProjectImageVersions, palette: Palette): readonly Image[] {
  return [versions[palette], versions[otherPalette(palette)]].filter((image) => image !== null);
}

/**
 * A Project's Icon or Logo in the version for the palette shown, or for `palette` when given. The
 * other version shows when that one is missing or fails to load, and none once both have failed;
 * another image, under its own id, gets a try.
 */
export function useShownProjectImage(
  projectId: string | undefined,
  versions: ProjectImageVersions | undefined,
  palette?: Palette,
): ShownImage {
  const shownPalette = useAppearance().palette;
  const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(new Set());
  const image =
    versions &&
    versionsToTry(versions, palette ?? shownPalette).find(({ id }) => !failedIds.has(id));
  if (projectId === undefined || image === undefined)
    return { address: undefined, onError: () => {} };
  return {
    address: projectImageAddress(projectId, image.id),
    onError: () => setFailedIds((failed) => new Set(failed).add(image.id)),
  };
}

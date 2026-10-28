import type { InstalledSource, PinnedVersion } from "@the-office/contracts";

/** A pinned version as the user reads it: its tag, or its commit's first characters. */
export function pinnedVersionLabel(pinnedVersion: PinnedVersion): string {
  return pinnedVersion.tag ?? pinnedVersion.commit.slice(0, 7);
}

/** Where an installed skill comes from: the repository, and its folder there unless the top. */
export function sourceLabel({
  repository,
  folder,
}: Pick<InstalledSource, "repository" | "folder">): string {
  return folder === "" ? repository : `${repository} · ${folder}`;
}

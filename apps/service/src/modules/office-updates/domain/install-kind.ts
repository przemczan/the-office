/**
 * How The Office was installed (docs/running-the-office.md): a git checkout updated by its launcher,
 * a release tarball unpacked into a releases folder under its launcher, or a container image run by
 * Docker Compose.
 */
export type InstallKind = "checkout" | "release" | "container";

/**
 * The install kind, from `OFFICE_INSTALL` (set by the image for a container, and by the launcher for
 * a release it runs from its releases folder) and whether the folder carries a release's stamp: a
 * release copy run any other way is still a release, one that can't update itself.
 */
export function installKindOf(
  variable: InstallKind | undefined,
  hasReleaseStamp: boolean,
): InstallKind {
  if (variable === "container") return "container";
  if (variable === "release" || hasReleaseStamp) return "release";
  return "checkout";
}

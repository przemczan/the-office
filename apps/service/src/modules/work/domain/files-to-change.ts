/*
 * Files to change: the files and folders a Plan expects to change, as paths inside the Project's
 * repository (spec §2.1, "Overlaps at Start"). A folder covers the files under it.
 */

/**
 * The paths as kept: trimmed, with forward slashes, without a leading "./" or "/" or a trailing
 * "/", the empty ones left out and each kept once, in the order given.
 */
export function normalizedFilesToChange(paths: readonly string[]): string[] {
  const normalized = paths
    .map((path) =>
      path
        .trim()
        .replaceAll("\\", "/")
        .replace(/^(\.\/|\/)+/, "")
        .replace(/\/+$/, ""),
    )
    .filter((path) => path !== "");
  return [...new Set(normalized)];
}

/** Why the paths, as normalized, can't be the Plan's files to change. */
export function filesToChangeProblems(paths: readonly string[]): string[] {
  const outside = paths.filter((path) => path.split("/").includes(".."));
  return outside.length > 0
    ? [`Files to change stay inside the repository: ${outside.join(", ")}.`]
    : [];
}

/** Whether `path` is `covering` itself, or a file or folder under it. */
export function covers(covering: string, path: string): boolean {
  return path === covering || path.startsWith(`${covering}/`);
}

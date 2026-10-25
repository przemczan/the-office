import type { Workspace } from "./repository.ts";

/**
 * Why an import from one workspace into another breaks the workspace rules, or undefined if it
 * doesn't. Code outside every workspace, such as `design-system/`, is not a workspace's to guard.
 * The importer is undefined for code outside every workspace, such as the root's config files.
 */
export function workspaceBoundaryViolation(
  importer: Workspace | undefined,
  target: Workspace,
  isRelative: boolean,
): string | undefined {
  if (importer?.directory === target.directory) return undefined;
  // The root's config files are what runs the tools, as oxlint.config.ts runs the lint rules.
  if (importer === undefined && target.kind === "tool") return undefined;
  if (target.kind !== "package") {
    return `${target.directory} is run, never imported; code shared between workspaces belongs in a package under packages/.`;
  }
  return isRelative
    ? `This reaches into ${target.directory} by a relative path; import "${target.name}" by its package name.`
    : undefined;
}

import type { Workspace } from "./repository.ts";

/**
 * Why an import from one workspace into another breaks the workspace rules, or undefined if it
 * doesn't. Code outside every workspace, such as `design-system/`, is not a workspace's to guard.
 */
export function workspaceBoundaryViolation(
  importer: Workspace | undefined,
  target: Workspace,
  isRelative: boolean,
): string | undefined {
  if (importer?.directory === target.directory) return undefined;
  if (!target.isLibrary) {
    return `${target.directory} is run, never imported; code shared between workspaces belongs in a package under packages/.`;
  }
  return isRelative
    ? `This reaches into ${target.directory} by a relative path; import "${target.name}" by its package name.`
    : undefined;
}

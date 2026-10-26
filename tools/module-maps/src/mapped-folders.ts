import { readdirSync } from "node:fs";
import { join } from "node:path";

/** A folder that has a `MAP.md`, relative to the repository root with forward slashes. */
export interface MappedFolder {
  readonly folder: string;
  readonly title: string;
  /** Subfolders left to maps of their own. */
  readonly excluded: readonly string[];
}

/** Every service module and web surface gets a map, so a new one can't be left without. */
export function mappedFolders(repositoryRoot: string): MappedFolder[] {
  return [
    ...subfolders(repositoryRoot, "apps/service/src/modules").map((module) => ({
      folder: `apps/service/src/modules/${module}`,
      title: `${capitalized(module)}: module map`,
      excluded: [],
    })),
    { folder: "apps/service/src/platform", title: "Service platform: map", excluded: [] },
    { folder: "apps/web/src", title: "Web app: map", excluded: ["surfaces"] },
    ...subfolders(repositoryRoot, "apps/web/src/surfaces").map((surface) => ({
      folder: `apps/web/src/surfaces/${surface}`,
      title: `${capitalized(surface)} surface: map`,
      excluded: [],
    })),
    { folder: "apps/web/e2e", title: "Web end-to-end tests: map", excluded: [] },
    { folder: "packages/contracts/src", title: "Contracts: map", excluded: [] },
  ];
}

function subfolders(repositoryRoot: string, folder: string): string[] {
  return readdirSync(join(repositoryRoot, folder), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
}

function capitalized(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

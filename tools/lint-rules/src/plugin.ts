import { checkImports, type Import, type Rule } from "./imports.ts";
import { moduleBoundaryViolation, modulePackageViolation } from "./module-boundaries.ts";
import { isTestFile, placeOf } from "./module-layout.ts";
import { operatingSystemBranches } from "./operating-system-branches.ts";
import { restrictedSyntax } from "./restricted-syntax.ts";
import { workspaceBoundaryViolation } from "./workspace-boundaries.ts";

/** Keeps workspaces apart: apps and tools are never imported, packages only by their name. */
const workspaceBoundaries: Rule = {
  meta: { type: "problem", docs: { description: "Keep workspaces apart." } },
  create: (context) =>
    checkImports(context, ({ importerWorkspace, target }) =>
      target.workspace
        ? workspaceBoundaryViolation(importerWorkspace, target.workspace, target.kind === "file")
        : undefined,
    ),
};

/** Keeps each module's internals private and its layers pointing inward (apps/service/README.md). */
const moduleBoundaries: Rule = {
  meta: { type: "problem", docs: { description: "Keep modules apart and their layers inward." } },
  create: (context) => checkImports(context, moduleViolation),
};

function moduleViolation({ importerPath, importerWorkspace, target }: Import): string | undefined {
  if (!importerWorkspace) return undefined;
  const pathInWorkspace = (repositoryPath: string): string =>
    repositoryPath.slice(importerWorkspace.directory.length + 1);
  const importer = placeOf(pathInWorkspace(importerPath));
  const importerIsTest = isTestFile(importerPath);
  if (target.kind === "package") {
    return modulePackageViolation(importer, importerIsTest, target.name);
  }
  return target.workspace === importerWorkspace
    ? moduleBoundaryViolation({
        importer,
        importerIsTest,
        target: placeOf(pathInWorkspace(target.path)),
      })
    : undefined;
}

export default {
  meta: { name: "office" },
  rules: {
    "workspace-boundaries": workspaceBoundaries,
    "module-boundaries": moduleBoundaries,
    "operating-system-branches": operatingSystemBranches,
    "restricted-syntax": restrictedSyntax,
  },
};

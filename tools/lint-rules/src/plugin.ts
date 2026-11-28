import { caughtVoidedCalls } from "./caught-voided-calls.ts";
import { engineAdapterViolation } from "./engine-adapters.ts";
import { checkImports, type Import, type Rule } from "./imports.ts";
import { moduleBoundaryViolation, modulePackageViolation } from "./module-boundaries.ts";
import { isTestFile, placeOf } from "./module-layout.ts";
import { operatingSystemBranches } from "./operating-system-branches.ts";
import { restrictedSyntax } from "./restricted-syntax.ts";
import { WEB_APP_DIRECTORY, webLayerViolation, webPlaceAt } from "./web-layers.ts";
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

/** Keeps each module's internals private and its layers pointing inward (apps/service/docs/module-template.md). */
const moduleBoundaries: Rule = {
  meta: { type: "problem", docs: { description: "Keep modules apart and their layers inward." } },
  create: (context) => checkImports(context, moduleViolation),
};

function moduleViolation({
  importerPath,
  importerWorkspace,
  target,
  typeOnly,
}: Import): string | undefined {
  if (!importerWorkspace) return undefined;
  const pathInWorkspace = (repositoryPath: string): string =>
    repositoryPath.slice(importerWorkspace.directory.length + 1);
  const importerInWorkspace = pathInWorkspace(importerPath);
  const importer = placeOf(importerInWorkspace);
  const importerIsTest = isTestFile(importerPath);
  if (target.kind === "package") {
    return modulePackageViolation(importer, importerIsTest, target.name);
  }
  if (target.workspace !== importerWorkspace) return undefined;
  const targetInWorkspace = pathInWorkspace(target.path);
  return (
    moduleBoundaryViolation({
      importer,
      importerIsTest,
      target: placeOf(targetInWorkspace),
      typeOnly,
    }) ?? engineAdapterViolation(importerInWorkspace, importerIsTest, targetInWorkspace)
  );
}

/** Keeps the web app's areas apart: api, shell and each surface (AGENTS.md, Project layout and defaults). */
const webLayers: Rule = {
  meta: { type: "problem", docs: { description: "Keep the web app's areas apart." } },
  create: (context) =>
    checkImports(context, ({ importerPath, importerWorkspace, target }) => {
      const withinWebApp =
        importerWorkspace?.directory === WEB_APP_DIRECTORY &&
        target.kind === "file" &&
        target.workspace?.directory === WEB_APP_DIRECTORY;
      return withinWebApp
        ? webLayerViolation(webPlaceAt(importerPath), webPlaceAt(target.path))
        : undefined;
    }),
};

export default {
  meta: { name: "office" },
  rules: {
    "caught-voided-calls": caughtVoidedCalls,
    "workspace-boundaries": workspaceBoundaries,
    "module-boundaries": moduleBoundaries,
    "operating-system-branches": operatingSystemBranches,
    "restricted-syntax": restrictedSyntax,
    "web-layers": webLayers,
  },
};

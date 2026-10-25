import path from "node:path";
import type { RuleTester } from "oxlint/plugins-dev";
import {
  repositoryOf,
  repositoryPath,
  workspaceAt,
  workspaceNamed,
  type Workspace,
} from "./repository.ts";

// oxlint/plugins-dev exports the rule tester but not the plugin types, so they are taken from it.
export type Rule = Parameters<RuleTester["run"]>[1];
type Context = Parameters<NonNullable<Rule["create"]>>[0];
type Visitor = ReturnType<NonNullable<Rule["create"]>>;
type ReportedNode = NonNullable<Parameters<Context["report"]>[0]["node"]>;

export interface Import {
  /** Relative to the repository root, with forward slashes. */
  readonly importerPath: string;
  readonly importerWorkspace: Workspace | undefined;
  readonly target: ImportTarget;
}

export type ImportTarget =
  | {
      readonly kind: "file";
      /** Relative to the repository root, with forward slashes. */
      readonly path: string;
      readonly workspace: Workspace | undefined;
    }
  | { readonly kind: "package"; readonly name: string; readonly workspace: Workspace | undefined };

/** Why the import breaks a rule, or undefined if it doesn't. */
export type ImportCheck = (anImport: Import) => string | undefined;

/**
 * Runs the check on every import of the file: static and dynamic imports, re-exports and import
 * types, type-only ones included. Specifiers that are neither relative nor a package are skipped.
 */
export function checkImports(context: Context, check: ImportCheck): Visitor {
  const repository = repositoryOf(context.filename);
  if (!repository) return {};
  const importerPath = repositoryPath(repository, path.resolve(context.filename));
  const importerWorkspace = workspaceAt(repository, importerPath);

  const checkSource = (source: ReportedNode & { readonly value: unknown }): void => {
    if (typeof source.value !== "string") return;
    const target = targetOf(source.value);
    const violation = target && check({ importerPath, importerWorkspace, target });
    if (violation) context.report({ node: source, message: violation });
  };

  const targetOf = (specifier: string): ImportTarget | undefined => {
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      const absolutePath = path.resolve(path.dirname(context.filename), specifier);
      const targetPath = repositoryPath(repository, absolutePath);
      return { kind: "file", path: targetPath, workspace: workspaceAt(repository, targetPath) };
    }
    const name = packageNameOf(specifier);
    return name === undefined
      ? undefined
      : { kind: "package", name, workspace: workspaceNamed(repository, name) };
  };

  return {
    ImportDeclaration: (node) => checkSource(node.source),
    ExportNamedDeclaration: (node) => node.source && checkSource(node.source),
    ExportAllDeclaration: (node) => checkSource(node.source),
    ImportExpression: (node) => node.source.type === "Literal" && checkSource(node.source),
    TSImportType: (node) => checkSource(node.source),
  };
}

/** The package a bare specifier names (`@scope/name` or `name`), or undefined if it names none. */
function packageNameOf(specifier: string): string | undefined {
  if (specifier.startsWith("/") || /^[a-z]+:/i.test(specifier)) return undefined;
  const segments = specifier.split("/");
  return specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
}

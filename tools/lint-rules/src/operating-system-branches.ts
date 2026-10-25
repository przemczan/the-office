import path from "node:path";
import type { Rule } from "./imports.ts";
import { repositoryOf, repositoryPath } from "./repository.ts";

type Context = Parameters<NonNullable<Rule["create"]>>[0];
type Visitor = ReturnType<NonNullable<Rule["create"]>>;
type MemberExpression = Parameters<NonNullable<Visitor["MemberExpression"]>>[0];
type Expression = MemberExpression["object"];
type ImportedName = Parameters<NonNullable<Visitor["ImportSpecifier"]>>[0]["imported"];
type PropertyKey = Parameters<NonNullable<Visitor["Property"]>>[0]["key"];

/** The product's code (spec §5.1); tools such as the engine check run per system themselves. */
const GUARDED_DIRECTORIES = ["apps/", "packages/"];
const PLATFORM_LAYER = "apps/service/src/platform/os/";

const OS_MODULES = new Set(["os", "node:os"]);
/** The node:os functions that tell which system this is. */
const SYSTEM_READERS = new Set(["platform", "type"]);

const MESSAGE =
  "Only apps/service/src/platform/os/ branches on the operating system (spec §5.1); ask currentOperatingSystem() for what differs.";

/** Whether code at this repository path may read which operating system it runs on. */
export function mayReadOperatingSystem(filePath: string): boolean {
  return (
    filePath.startsWith(PLATFORM_LAYER) ||
    !GUARDED_DIRECTORIES.some((directory) => filePath.startsWith(directory))
  );
}

/** Refuses reading which system this is (`process.platform`, `os.platform()`, `os.type()`) outside the platform layer. */
export const operatingSystemBranches: Rule = {
  meta: {
    type: "problem",
    docs: { description: "Branch on the operating system only in src/platform/os/." },
  },
  create: (context) => {
    const repository = repositoryOf(context.filename);
    if (!repository) return {};
    if (mayReadOperatingSystem(repositoryPath(repository, path.resolve(context.filename)))) {
      return {};
    }
    return readsOfTheOperatingSystem(context);
  },
};

function readsOfTheOperatingSystem(context: Context): Visitor {
  // Default and namespace imports of node:os, whose platform() and type() are then refused.
  const osNamespaces = new Set<string>();
  return {
    ImportDeclaration: (node) => {
      if (!OS_MODULES.has(String(node.source.value))) return;
      for (const specifier of node.specifiers) {
        if (specifier.type !== "ImportSpecifier") {
          osNamespaces.add(specifier.local.name);
        } else if (isSystemReader(nameOf(specifier.imported))) {
          context.report({ node: specifier, message: MESSAGE });
        }
      }
    },
    MemberExpression: (node) => {
      const property = propertyName(node);
      const readsPlatform = property === "platform" && isProcess(node.object);
      const readsOs =
        isSystemReader(property) &&
        node.object.type === "Identifier" &&
        osNamespaces.has(node.object.name);
      if (readsPlatform || readsOs) context.report({ node, message: MESSAGE });
    },
    VariableDeclarator: (node) => {
      if (node.id.type !== "ObjectPattern" || !node.init || !isProcess(node.init)) return;
      for (const property of node.id.properties) {
        if (property.type === "Property" && nameOf(property.key) === "platform") {
          context.report({ node: property, message: MESSAGE });
        }
      }
    },
  };
}

function isSystemReader(name: string | undefined): boolean {
  return name !== undefined && SYSTEM_READERS.has(name);
}

/** `process`, `globalThis.process` or `global.process`. */
function isProcess(expression: Expression): boolean {
  if (expression.type === "Identifier") return expression.name === "process";
  return (
    expression.type === "MemberExpression" &&
    propertyName(expression) === "process" &&
    expression.object.type === "Identifier" &&
    (expression.object.name === "globalThis" || expression.object.name === "global")
  );
}

/** The property a member expression reads, when it is named by an identifier or a string. */
function propertyName(node: MemberExpression): string | undefined {
  if (!node.computed) return node.property.type === "Identifier" ? node.property.name : undefined;
  return node.property.type === "Literal" && typeof node.property.value === "string"
    ? node.property.value
    : undefined;
}

/** The name an import or a destructured property names, when it is an identifier or a string. */
function nameOf(node: ImportedName | PropertyKey): string | undefined {
  if (node.type === "Identifier") return node.name;
  return node.type === "Literal" && typeof node.value === "string" ? node.value : undefined;
}

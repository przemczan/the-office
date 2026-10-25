import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export type WorkspaceKind = "app" | "package" | "tool";

export interface Workspace {
  readonly name: string;
  /** Relative to the repository root, with forward slashes, e.g. `apps/service`. */
  readonly directory: string;
  /** Only packages are libraries; apps and tools are run, never imported (Build defaults). */
  readonly kind: WorkspaceKind;
}

export interface Repository {
  readonly root: string;
  readonly workspaces: readonly Workspace[];
}

/** Each kind of workspace by the top directory it lives in. */
const KINDS_BY_DIRECTORY: Readonly<Record<string, WorkspaceKind>> = {
  apps: "app",
  packages: "package",
  tools: "tool",
};

const repositoriesByDirectory = new Map<string, Repository | undefined>();

/** The npm workspaces repository holding the file, or undefined when it is in none. */
export function repositoryOf(filename: string): Repository | undefined {
  return repositoryAt(path.dirname(path.resolve(filename)));
}

/** Where a path lies in the repository: relative to its root, with forward slashes. */
export function repositoryPath(repository: Repository, absolutePath: string): string {
  return path.relative(repository.root, absolutePath).split(path.sep).join("/");
}

export function workspaceAt(repository: Repository, filePath: string): Workspace | undefined {
  return repository.workspaces.find((workspace) => filePath.startsWith(`${workspace.directory}/`));
}

export function workspaceNamed(repository: Repository, name: string): Workspace | undefined {
  return repository.workspaces.find((workspace) => workspace.name === name);
}

function repositoryAt(directory: string): Repository | undefined {
  if (repositoriesByDirectory.has(directory)) return repositoriesByDirectory.get(directory);
  const workspacePatterns = readPackageJson(directory)?.workspaces;
  const parent = path.dirname(directory);
  const repository = workspacePatterns
    ? { root: directory, workspaces: readWorkspaces(directory, workspacePatterns) }
    : parent === directory
      ? undefined
      : repositoryAt(parent);
  repositoriesByDirectory.set(directory, repository);
  return repository;
}

/** Supports the patterns this repository uses: a directory, or `<directory>/*`. */
function readWorkspaces(root: string, patterns: readonly string[]): Workspace[] {
  return patterns.flatMap((pattern) => {
    if (pattern.includes("*") && !/^[^*]+\/\*$/.test(pattern)) {
      throw new Error(`The workspace pattern "${pattern}" is not supported by the lint rules.`);
    }
    const directories = pattern.endsWith("/*")
      ? childDirectories(root, pattern.slice(0, -2))
      : [pattern];
    return directories.flatMap((directory) => {
      const name = readPackageJson(path.join(root, directory))?.name;
      return name ? [{ name, directory, kind: kindOf(directory) }] : [];
    });
  });
}

function kindOf(directory: string): WorkspaceKind {
  const kind = KINDS_BY_DIRECTORY[directory.split("/")[0]!];
  if (!kind) {
    throw new Error(
      `The workspace ${directory} is in none of apps/, packages/ and tools/, which the lint rules know.`,
    );
  }
  return kind;
}

function childDirectories(root: string, parent: string): string[] {
  const absoluteParent = path.join(root, parent);
  if (!existsSync(absoluteParent)) return [];
  return readdirSync(absoluteParent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${parent}/${entry.name}`);
}

interface PackageJson {
  readonly name?: string;
  readonly workspaces?: string[];
}

function readPackageJson(directory: string): PackageJson | undefined {
  const packageJsonPath = path.join(directory, "package.json");
  if (!existsSync(packageJsonPath)) return undefined;
  return JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJson;
}

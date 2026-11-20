import { posix } from "node:path";
import { ProjectRefused } from "./project-refused.js";

/**
 * One of the repository's own entry points, which a test target names (spec §2.12, "Entry points
 * only"): structured, so inline shell can't be written; arguments are given one by one, never read
 * by a shell.
 */
export type EntryPoint =
  | {
      readonly kind: "repository-file";
      /** From the repository's root, such as `scripts/start-test.sh`. */
      readonly path: string;
      readonly arguments: readonly string[];
    }
  | {
      readonly kind: "package-script";
      /** The manifest's path from the repository's root, such as `package.json`. */
      readonly manifest: string;
      readonly script: string;
      readonly arguments: readonly string[];
    }
  | { readonly kind: "gradle-task"; readonly task: string; readonly arguments: readonly string[] }
  | { readonly kind: "devcontainer-service"; readonly service: string };

/** The Gradle wrapper a Gradle task runs through, at the repository's root. */
export const GRADLE_WRAPPER = "gradlew";

// Each name starts with a letter or digit, so a "task" such as --init-script can't pass as an option.
const GRADLE_TASK = /^:?\w[\w-]*(:\w[\w-]*)*$/;

/** A commit's files as an entry point is checked against them. */
export interface EntryPointTree {
  /** Whether `path`, from the repository's root, is a file there, whatever its size. */
  isFile(path: string): Promise<boolean>;
  /** The text of the file `path` names; undefined when it names no file. */
  textAt(path: string): Promise<string | undefined>;
  /** The services of the repository's `.devcontainer/` definition; undefined when it has none. */
  devcontainerServices(): Promise<readonly string[] | undefined>;
}

/** The entry point with the spaces around its fields left out; arguments stay as given. */
export function trimmedEntryPoint(entryPoint: EntryPoint): EntryPoint {
  switch (entryPoint.kind) {
    case "repository-file":
      return { ...entryPoint, path: entryPoint.path.trim() };
    case "package-script":
      return {
        ...entryPoint,
        manifest: entryPoint.manifest.trim(),
        script: entryPoint.script.trim(),
      };
    case "gradle-task":
      return { ...entryPoint, task: entryPoint.task.trim() };
    case "devcontainer-service":
      return { ...entryPoint, service: entryPoint.service.trim() };
  }
}

/** Compared field by field, as a jsonb column gives an object's keys back in an order of its own. */
export function sameEntryPoint(one: EntryPoint, other: EntryPoint): boolean {
  switch (one.kind) {
    case "repository-file":
      return (
        other.kind === one.kind &&
        other.path === one.path &&
        sameArguments(one.arguments, other.arguments)
      );
    case "package-script":
      return (
        other.kind === one.kind &&
        other.manifest === one.manifest &&
        other.script === one.script &&
        sameArguments(one.arguments, other.arguments)
      );
    case "gradle-task":
      return (
        other.kind === one.kind &&
        other.task === one.task &&
        sameArguments(one.arguments, other.arguments)
      );
    case "devcontainer-service":
      return other.kind === one.kind && other.service === one.service;
  }
}

function sameArguments(one: readonly string[], other: readonly string[]): boolean {
  return one.length === other.length && one.every((argument, index) => argument === other[index]);
}

/** How the entry point reads in one line, such as `package.json › start`. */
export function entryPointWords(entryPoint: EntryPoint): string {
  switch (entryPoint.kind) {
    case "repository-file":
      return withArguments(`file ${entryPoint.path}`, entryPoint.arguments);
    case "package-script":
      return withArguments(
        `script ${entryPoint.script} of ${entryPoint.manifest}`,
        entryPoint.arguments,
      );
    case "gradle-task":
      return withArguments(`Gradle task ${entryPoint.task}`, entryPoint.arguments);
    case "devcontainer-service":
      return `.devcontainer/ service ${entryPoint.service}`;
  }
}

function withArguments(words: string, entryPointArguments: readonly string[]): string {
  return entryPointArguments.length === 0
    ? words
    : `${words} with ${entryPointArguments.map((each) => JSON.stringify(each)).join(" ")}`;
}

/**
 * The path from the repository's root that `path` names, `/` between names and no `.` folder; or
 * undefined when it leaves the repository (absolute, a drive, a `..` above the root).
 */
export function pathInRepository(path: string): string | undefined {
  const slashed = path.replaceAll("\\", "/");
  if (slashed.startsWith("/") || /^[A-Za-z]:/.test(slashed)) return undefined;
  const normalised = posix.normalize(slashed).replace(/\/$/, "");
  if (normalised === ".." || normalised.startsWith("../")) return undefined;
  return normalised === "." ? "" : normalised;
}

/** Why the entry point can't be one, read without the repository; each reason a sentence. */
export function entryPointShapeProblems(entryPoint: EntryPoint): string[] {
  const problems: string[] = [];
  switch (entryPoint.kind) {
    case "repository-file":
      problems.push(...repositoryPathProblems("the file", entryPoint.path));
      break;
    case "package-script":
      problems.push(...repositoryPathProblems("the package manifest", entryPoint.manifest));
      if (entryPoint.script === "") problems.push("Name the package script.");
      else if (/[\r\n\0]/.test(entryPoint.script)) {
        problems.push("The package script's name must be one line.");
      }
      break;
    case "gradle-task":
      if (entryPoint.task === "") problems.push("Name the Gradle task.");
      else if (!GRADLE_TASK.test(entryPoint.task)) {
        problems.push(
          `"${entryPoint.task}" isn't a Gradle task: give its name, such as assembleDebug or :app:assembleDebug.`,
        );
      }
      break;
    case "devcontainer-service":
      if (entryPoint.service === "") problems.push("Name the .devcontainer/ service.");
      return problems;
  }
  if (entryPoint.arguments.some((argument) => /[\r\n\0]/.test(argument))) {
    problems.push("Each argument must be one line.");
  }
  return problems;
}

function repositoryPathProblems(what: string, path: string): string[] {
  if (path === "") return [`Give the path of ${what}.`];
  if (/[\r\n\0]/.test(path)) return [`The path of ${what} must be one line.`];
  const inRepository = pathInRepository(path);
  if (inRepository === undefined || inRepository === "") {
    return [`The path of ${what}, ${path}, must be inside the repository, from its root.`];
  }
  return [];
}

/**
 * Why the entry point isn't one of the repository's at `tree`'s commit: its shape first, then the
 * file, the manifest's script, the Gradle wrapper or the `.devcontainer/` service it names.
 */
export async function entryPointProblems(
  entryPoint: EntryPoint,
  tree: EntryPointTree,
): Promise<string[]> {
  const shapeProblems = entryPointShapeProblems(entryPoint);
  if (shapeProblems.length > 0) return shapeProblems;
  switch (entryPoint.kind) {
    case "repository-file": {
      const path = pathInRepository(entryPoint.path) ?? entryPoint.path;
      return (await tree.isFile(path)) ? [] : [`The repository has no file ${path}.`];
    }
    case "package-script":
      return packageScriptProblems(entryPoint.manifest, entryPoint.script, tree);
    case "gradle-task":
      return (await tree.isFile(GRADLE_WRAPPER))
        ? []
        : [
            `The repository has no Gradle wrapper, ${GRADLE_WRAPPER}, at its root, which a Gradle task runs through.`,
          ];
    case "devcontainer-service": {
      const services = await tree.devcontainerServices();
      if (services === undefined) {
        return [
          `The repository has no .devcontainer/ definition that can be read, so it has no service ${entryPoint.service}.`,
        ];
      }
      return services.includes(entryPoint.service)
        ? []
        : [
            `The repository's .devcontainer/ has no service ${entryPoint.service}; it has ${services.join(", ") || "none"}.`,
          ];
    }
  }
}

async function packageScriptProblems(
  manifest: string,
  script: string,
  tree: EntryPointTree,
): Promise<string[]> {
  const path = pathInRepository(manifest) ?? manifest;
  let text: string | undefined;
  try {
    text = await tree.textAt(path);
  } catch (error) {
    if (error instanceof ProjectRefused) return [...error.reasons];
    throw error;
  }
  if (text === undefined) return [`The repository has no package manifest ${path}.`];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [`The package manifest ${path} isn't valid JSON.`];
  }
  const scripts =
    typeof parsed === "object" && parsed !== null && "scripts" in parsed
      ? parsed.scripts
      : undefined;
  const listed =
    typeof scripts === "object" &&
    scripts !== null &&
    Object.hasOwn(scripts, script) &&
    typeof (scripts as Record<string, unknown>)[script] === "string";
  return listed ? [] : [`The package manifest ${path} has no script ${script} in its "scripts".`];
}

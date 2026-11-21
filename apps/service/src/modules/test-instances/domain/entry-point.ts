import { posix } from "node:path";

/** A test target's entry point, one of the repository's own (spec §2.12, "Entry points only"). */
export type TargetEntryPoint =
  | {
      readonly kind: "repository-file";
      readonly path: string;
      readonly arguments: readonly string[];
    }
  | {
      readonly kind: "package-script";
      readonly manifest: string;
      readonly script: string;
      readonly arguments: readonly string[];
    }
  | { readonly kind: "gradle-task"; readonly task: string; readonly arguments: readonly string[] }
  | { readonly kind: "devcontainer-service"; readonly service: string };

/** Why a Build to install target can't have a devcontainer service as its entry point. */
export const DEVCONTAINER_SERVICE_BUILDS_NOTHING =
  "A devcontainer service builds nothing; name a build entry point.";

/** A build's command on the workstation: the folder from the checkout's root and a POSIX line. */
export interface WorkstationBuildCommand {
  /** Relative to the checkout, forward slashes; `.` for its root. */
  readonly folder: string;
  /** Every word single-quoted, so nothing the target names is read by the shell. */
  readonly commandLine: string;
}

/**
 * A Build to install entry point as a command line on the workstation (spec §2.12, "Entry points
 * only"), the same command the run environment runs: a repository file as `./<path>` from the
 * checkout's root, a package script by `npm run <script> --` in its manifest's folder, a Gradle
 * task through `./gradlew`. A devcontainer service builds nothing, and a path leading out of the
 * checkout is refused; either answers a problem.
 */
export function workstationBuildCommandOf(
  entryPoint: TargetEntryPoint,
): WorkstationBuildCommand | { readonly problem: string } {
  switch (entryPoint.kind) {
    case "repository-file": {
      const path = repositoryPath(entryPoint.path);
      if (path === undefined || path === ".") {
        return { problem: `The entry point ${entryPoint.path} isn't a file in the repository.` };
      }
      return { folder: ".", commandLine: shellLine([`./${path}`, ...entryPoint.arguments]) };
    }
    case "package-script": {
      const manifest = repositoryPath(entryPoint.manifest);
      if (manifest === undefined || manifest === ".") {
        return { problem: `The manifest ${entryPoint.manifest} isn't a file in the repository.` };
      }
      return {
        folder: posix.dirname(manifest),
        commandLine: shellLine(["npm", "run", entryPoint.script, "--", ...entryPoint.arguments]),
      };
    }
    case "gradle-task":
      return {
        folder: ".",
        commandLine: shellLine(["./gradlew", entryPoint.task, ...entryPoint.arguments]),
      };
    case "devcontainer-service":
      return { problem: DEVCONTAINER_SERVICE_BUILDS_NOTHING };
  }
}

function shellLine(words: readonly string[]): string {
  return words.map((word) => `'${word.replaceAll("'", `'\\''`)}'`).join(" ");
}

/** The path from the repository's root with forward slashes, or none when it leads out of it. */
function repositoryPath(given: string): string | undefined {
  const path = posix.normalize(given.trim().replaceAll("\\", "/"));
  if (posix.isAbsolute(path) || path === ".." || path.startsWith("../")) return undefined;
  return path.replace(/\/+$/, "");
}

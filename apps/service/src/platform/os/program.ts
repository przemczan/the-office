import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { join } from "node:path";
import spawn from "cross-spawn";
import type { OperatingSystem } from "./operating-system.js";
import type { ProcessTrees } from "./process-trees.js";

/** A program a user named by its command, such as a local MCP server's `npx`, to start without a shell. */
export interface Program {
  readonly command: string;
  readonly arguments: readonly string[];
  readonly workingFolder: string;
  /** Its whole environment: nothing is inherited beyond it. */
  readonly environment: Readonly<Record<string, string>>;
}

/**
 * Starts the program as a shell would find its command: on Windows `npx` is `npx.cmd`, which only
 * cmd.exe runs, so cross-spawn runs it there with each argument quoted for it, never letting an
 * argument be read as more of the command line. Started as `processTrees` needs, so `end` ends it
 * with everything it started, cmd.exe's child among them. Its standard streams are pipes.
 */
export function startProgram(
  program: Program,
  processTrees: ProcessTrees,
): ChildProcessWithoutNullStreams {
  // With every stream a pipe, none of them is null.
  return spawn(program.command, [...program.arguments], {
    cwd: program.workingFolder,
    env: { ...program.environment },
    stdio: "pipe",
    detached: processTrees.detached,
    windowsHide: true,
  }) as ChildProcessWithoutNullStreams;
}

/**
 * Whether `environment`'s PATH finds `command` as a shell would: on Windows under each of its
 * PATHEXT endings too, as `npx` is `npx.cmd`.
 */
export async function isOnPath(
  command: string,
  environment: Readonly<Record<string, string>>,
  { paths, sameVariableName }: Pick<OperatingSystem, "paths" | "sameVariableName">,
): Promise<boolean> {
  const variable = (name: string): string =>
    Object.entries(environment).find(([given]) => sameVariableName(given, name))?.[1] ?? "";
  const folders = variable("PATH").split(paths.pathListSeparator).filter(Boolean);
  const endings = ["", ...variable("PATHEXT").split(";").filter(Boolean)];
  const candidates = folders.flatMap((folder) =>
    endings.map((ending) => join(folder, `${command}${ending}`)),
  );
  const runnable = await Promise.all(candidates.map(canRun));
  return runnable.includes(true);
}

function canRun(file: string): Promise<boolean> {
  return access(file, constants.X_OK).then(
    () => true,
    () => false,
  );
}

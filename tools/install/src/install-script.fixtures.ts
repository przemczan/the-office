// Calls install.sh's functions, sourced into bash, for the installer's tests.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const INSTALL_SCRIPT = fileURLToPath(new URL("../install.sh", import.meta.url));

export interface BashResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs `install.sh`'s function `name` with `args`, the script sourced so main doesn't run. */
export function callFunction(
  name: string,
  args: readonly string[] = [],
  environment: NodeJS.ProcessEnv = {},
): BashResult {
  return bash(`source "$1"; shift; "$@"`, [INSTALL_SCRIPT, name, ...args], environment);
}

/** Runs `script` in bash with install.sh sourced; `$1`… are `args`. */
export function withScript(script: string, args: readonly string[] = []): BashResult {
  return bash(`source "$1"; shift\n${script}`, [INSTALL_SCRIPT, ...args], {});
}

function bash(script: string, args: readonly string[], environment: NodeJS.ProcessEnv): BashResult {
  // $0 is "bash", not the script, so sourcing it runs no main.
  const result = spawnSync("bash", ["-c", script, "bash", ...args], {
    encoding: "utf8",
    env: { PATH: process.env["PATH"], ...environment },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

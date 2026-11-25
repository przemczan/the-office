import { appendFile } from "node:fs/promises";
import { finished } from "node:stream/promises";
import type { AttachedProcess, RunEnvironmentAttachment } from "../../run-environments/index.js";
import type { AdbInstallEnd } from "../domain/device-install.js";
import type { InstanceMask } from "../ports/project-test-targets.js";

/**
 * Starts adb's server with its output and input away from the install's, then runs adb: a server
 * started by the install itself would otherwise hold its output open after adb ends. adb's
 * standard error joins its output, where it says why an install failed.
 */
const ADB_WITH_SERVER_APART = 'adb start-server </dev/null >/dev/null 2>&1; exec adb "$@" 2>&1';

/** Where adb runs: an Install on a device instance's environment, while it runs. */
export interface AdbPlace {
  attach(attachment: RunEnvironmentAttachment): Promise<AttachedProcess | undefined>;
}

/**
 * Runs `adb <adbArguments>` in the instance's environment to its end, its output appended to the
 * log masked as it comes, and answers how it ended with what it printed; stopped once `signal`
 * aborts (the Install time ran out, the instance stopped, its hold ended), answering no exit code.
 * Answers no exit code and nothing printed when the environment isn't running.
 */
export async function runAdbInstall(
  place: AdbPlace,
  adbArguments: readonly string[],
  logFile: string,
  mask: InstanceMask,
  signal: AbortSignal,
): Promise<AdbInstallEnd> {
  if (signal.aborted) return { exitCode: undefined, output: "" };
  const process = await place.attach({
    arguments: ["sh", "-c", ADB_WITH_SERVER_APART, "sh", ...adbArguments],
    logFile,
  });
  if (process === undefined) return { exitCode: undefined, output: "" };
  const stop = (): void => process.stop();
  signal.addEventListener("abort", stop, { once: true });
  const output: Buffer[] = [];
  const masking = mask.chunks();
  // One append after another, so the log keeps adb's order.
  let written = Promise.resolve();
  const append = (bytes: Uint8Array): void => {
    if (bytes.length === 0) return;
    written = written.then(() => appendFile(logFile, bytes));
  };
  process.stdout.on("data", (chunk: Buffer) => {
    output.push(chunk);
    append(masking.next(chunk));
  });
  try {
    const [end] = await Promise.all([
      process.ended,
      finished(process.stdout).catch(() => undefined),
    ]);
    append(masking.end());
    await written;
    return {
      exitCode: end.endedBy === undefined ? end.exitCode : undefined,
      output: Buffer.concat(output).toString("utf8"),
    };
  } finally {
    signal.removeEventListener("abort", stop);
  }
}

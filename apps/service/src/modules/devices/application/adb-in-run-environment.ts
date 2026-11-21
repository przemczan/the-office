import { finished } from "node:stream/promises";
import { Injectable, Logger } from "@nestjs/common";
import { Schedule } from "../../../platform/schedule/schedule.js";
import {
  DEVICE_HELPER_NOT_BUILT,
  DeviceHelperFiles,
  RunEnvironments,
} from "../../run-environments/index.js";
import { newAdbKey, type AdbKey } from "../domain/adb-key.js";
import { AdbKeyInput } from "../ports/adb-key-input.js";
import { AdbKeyRepository } from "../ports/adb-key-repository.js";
import { hostHelperArchitecture } from "./device-helper-architecture.js";

/** Said when the Project's run environment has no adb (spec §2.13, "What the image needs"). */
export const ADB_MISSING =
  "adb isn't in this Project's run environment. Add Android's platform-tools to .devcontainer, then connect again.";

/** How long each adb step may take before it is stopped. */
export const ADB_STEP_TIMEOUT_MS = 20_000;

/**
 * Starts adb's server with its output and input away from the step's, then runs adb: a server
 * started by the step itself would otherwise hold the step's output open after adb ends.
 */
const ADB_WITH_SERVER_APART = 'adb start-server </dev/null >/dev/null 2>&1; exec adb "$@"';

/** How a step in the run environment ended, with what it printed. */
interface StepEnd {
  readonly exitCode: number | undefined;
  readonly output: string;
}

/**
 * Whether adb is there: `missing` with words for the user, or `not-running` when the run
 * environment isn't running or the check was cut off with no exit code (the run environment
 * stopped, the step's timeout, or the exec failing).
 */
export type AdbCheck = "present" | "missing" | "not-running";

/**
 * adb in a Task's run environment, for both Android kinds (spec §2.13): the check that it's
 * there, the Project's adb key written into `~/.android`, and `adb connect` and `adb disconnect`.
 * Each step is one program attached as the checks' user, stopped after `ADB_STEP_TIMEOUT_MS`.
 * The key goes on the helper's standard input only: never a command line, a log or the web.
 */
@Injectable()
export class AdbInRunEnvironment {
  private readonly logger = new Logger(AdbInRunEnvironment.name);

  constructor(
    private readonly environments: RunEnvironments,
    private readonly helperFiles: DeviceHelperFiles,
    private readonly keys: AdbKeyRepository,
    private readonly keyInput: AdbKeyInput,
    private readonly schedule: Schedule,
  ) {}

  async ensureAdb(taskId: string): Promise<AdbCheck> {
    const end = await this.step(taskId, ["sh", "-c", "command -v adb"]);
    if (end?.exitCode === undefined) return "not-running";
    return end.exitCode === 0 ? "present" : "missing";
  }

  /**
   * Writes the Project's adb key, made the first time, into `~/.android`; a running adb server
   * restarts when it changed, to read it. Answers why it failed, or nothing.
   */
  async writeKey(taskId: string, projectId: string): Promise<string | undefined> {
    const executable = await this.helperFiles.executableFor(hostHelperArchitecture());
    if (executable === undefined) return DEVICE_HELPER_NOT_BUILT;
    const key = await this.keyOf(projectId);
    const end = await this.step(taskId, [executable, "adb-key"], this.keyInput.of(key));
    // Cut off with no exit code, as when the run environment stops: the helper's next READY retries.
    if (end?.exitCode === undefined) return undefined;
    if (end.exitCode !== 0) return "The adb key couldn't be written into the run environment.";
    if (end.output.trim() === "written") await this.step(taskId, ["adb", "kill-server"]);
    return undefined;
  }

  /** `adb connect <serial>`; whether adb says it connected, logged when it doesn't. */
  async connect(taskId: string, serial: string): Promise<boolean> {
    const end = await this.adb(taskId, ["connect", serial]);
    const connected = end?.exitCode === 0 && /connected to/i.test(end.output);
    if (end !== undefined && !connected) {
      this.logger.warn(`adb connect ${serial} in the Task ${taskId}: ${end.output.trim()}`);
    }
    return connected;
  }

  /** `adb disconnect <serial>`, best effort: nothing when the run environment isn't running. */
  async disconnect(taskId: string, serial: string): Promise<void> {
    await this.adb(taskId, ["disconnect", serial]);
  }

  private adb(taskId: string, adbArguments: readonly string[]): Promise<StepEnd | undefined> {
    return this.step(taskId, ["sh", "-c", ADB_WITH_SERVER_APART, "sh", ...adbArguments]);
  }

  private async keyOf(projectId: string): Promise<AdbKey> {
    const kept = await this.keys.find(projectId);
    if (kept !== undefined) return kept;
    return this.keys.keepFirst(await newAdbKey(projectId, this.schedule.now()));
  }

  /**
   * Runs one program in the Task's run environment to its end, its input written then closed;
   * undefined when the run environment isn't running.
   */
  private async step(
    taskId: string,
    programArguments: readonly string[],
    input: readonly Uint8Array[] = [],
  ): Promise<StepEnd | undefined> {
    const process = await this.environments.attach(taskId, { arguments: programArguments });
    if (process === undefined) return undefined;
    const output: Buffer[] = [];
    process.stdout.on("data", (chunk: Buffer) => void output.push(chunk));
    const timeout = this.schedule.once(
      "adb-step-timeout",
      new Date(this.schedule.now().getTime() + ADB_STEP_TIMEOUT_MS),
      () => {
        process.stop();
        return Promise.resolve();
      },
    );
    try {
      for (const chunk of input) process.stdin.write(chunk);
      process.stdin.end();
      const [end] = await Promise.all([
        process.ended,
        finished(process.stdout).catch(() => undefined),
      ]);
      return { exitCode: end.exitCode, output: Buffer.concat(output).toString("utf8") };
    } finally {
      timeout.cancel();
    }
  }
}

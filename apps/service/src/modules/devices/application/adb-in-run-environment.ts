import { finished } from "node:stream/promises";
import { Injectable, Logger } from "@nestjs/common";
import { Schedule } from "../../../platform/schedule/schedule.js";
import {
  DEVICE_HELPER_NOT_BUILT,
  DeviceHelperFiles,
  RunEnvironments,
  type AttachedProcess,
  type RunEnvironmentAttachment,
} from "../../run-environments/index.js";
import { newAdbKey, type AdbKey } from "../domain/adb-key.js";
import { AdbKeyInput } from "../ports/adb-key-input.js";
import { AdbKeyRepository } from "../ports/adb-key-repository.js";
import { hostHelperArchitecture } from "./device-helper-architecture.js";

/** Said when the Project's run environment has no adb (spec §2.13, "What the image needs"). */
export const ADB_MISSING =
  "adb isn't in this Project's run environment. Add Android's platform-tools to .devcontainer, then try again.";

/** Said when the run environment's adb is older than 30.0, which brought `adb pair`. */
export const ADB_WITHOUT_PAIR =
  "This run environment's adb can't pair over wireless debugging: it needs Android's platform-tools 30.0 or newer in .devcontainer.";

/** What `adb pair` asks the code with, before reading it from its standard input. */
const PAIRING_PROMPT = /^Enter pairing code:\s*/i;

/** Said when the pairing was cut off, as when the run environment stopped. */
const PAIRING_CUT_OFF = "The pairing was cut off before adb answered; pair it again.";

/** How long each adb step may take before it is stopped. */
export const ADB_STEP_TIMEOUT_MS = 20_000;

/**
 * Starts adb's server with its output and input away from the step's, then runs adb: a server
 * started by the step itself would otherwise hold the step's output open after adb ends. adb's
 * standard error joins its output, as it says there why a command failed (an older adb's
 * "unknown command pair", a query's error), which the step's output alone would miss.
 */
const ADB_WITH_SERVER_APART = 'adb start-server </dev/null >/dev/null 2>&1; exec adb "$@" 2>&1';

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
 * Where adb runs: a Task's run environment (`AdbInRunEnvironment.inTask`) or a Project device's
 * pairing environment.
 */
export interface AdbPlace {
  /** The Project whose adb key is written there. */
  readonly projectId: string;
  /** How a log line names it, such as "the Task <id>". */
  readonly label: string;
  /** Starts one program there as the checks' user; undefined when it isn't running. */
  attach(attachment: RunEnvironmentAttachment): Promise<AttachedProcess | undefined>;
}

/**
 * adb in a Task's run environment or a pairing environment, for both Android kinds (spec §2.13):
 * the check that it's there, the Project's adb key written into `~/.android`, and `adb connect`
 * and `adb disconnect`. Each step is one program attached as the checks' user, stopped after
 * `ADB_STEP_TIMEOUT_MS`. The key goes on the helper's standard input only: never a command line,
 * a log or the web.
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

  /** The Task's run environment, while it runs. */
  inTask(taskId: string, projectId: string): AdbPlace {
    return {
      projectId,
      label: `the Task ${taskId}`,
      attach: (attachment) => this.environments.attach(taskId, attachment),
    };
  }

  async ensureAdb(place: AdbPlace): Promise<AdbCheck> {
    const end = await this.step(place, ["sh", "-c", "command -v adb"]);
    if (end?.exitCode === undefined) return "not-running";
    return end.exitCode === 0 ? "present" : "missing";
  }

  /**
   * Writes the Project's adb key, made the first time, into `~/.android`; a running adb server
   * restarts when it changed, to read it. Answers why it failed, or nothing.
   */
  async writeKey(place: AdbPlace): Promise<string | undefined> {
    const executable = await this.helperFiles.executableFor(hostHelperArchitecture());
    if (executable === undefined) return DEVICE_HELPER_NOT_BUILT;
    const key = await this.keyOf(place.projectId);
    const end = await this.step(place, [executable, "adb-key"], this.keyInput.of(key));
    // Cut off with no exit code, as when the run environment stops: the helper's next READY retries.
    if (end?.exitCode === undefined) return undefined;
    if (end.exitCode !== 0) return "The adb key couldn't be written into the run environment.";
    if (end.output.trim() === "written") await this.step(place, ["adb", "kill-server"]);
    return undefined;
  }

  /** `adb connect <serial>`; whether adb says it connected, logged when it doesn't. */
  async connect(place: AdbPlace, serial: string): Promise<boolean> {
    const end = await this.adb(place, ["connect", serial]);
    const connected = end?.exitCode === 0 && /connected to/i.test(end.output);
    if (end !== undefined && !connected) {
      this.logger.warn(`adb connect ${serial} in ${place.label}: ${end.output.trim()}`);
    }
    return connected;
  }

  /**
   * `adb pair <target>`, the code written to its standard input and that closed, so it is never in
   * a command line, a variable or a log: answers why it didn't pair, in adb's words, or nothing.
   */
  async pair(place: AdbPlace, target: string, pairingCode: string): Promise<string | undefined> {
    const end = await this.adb(place, ["pair", target], [Buffer.from(`${pairingCode}\n`)]);
    if (end?.exitCode === undefined) return PAIRING_CUT_OFF;
    if (end.exitCode === 0 && /successfully paired/i.test(end.output)) return undefined;
    if (/unknown command/i.test(end.output)) return ADB_WITHOUT_PAIR;
    // adb prompts for the code on the line its answer follows, with no newline between.
    const said = lastLineOf(end.output)?.replace(PAIRING_PROMPT, "");
    return said === undefined || said === ""
      ? `adb didn't pair with the phone at ${target}.`
      : `adb didn't pair with the phone at ${target}: ${said}`;
  }

  /** The model the phone at the serial reports (`ro.product.model`), if it answers one. */
  async modelOf(place: AdbPlace, serial: string): Promise<string | undefined> {
    const end = await this.adb(place, ["-s", serial, "shell", "getprop", "ro.product.model"]);
    if (end?.exitCode !== 0) return undefined;
    return lastLineOf(end.output);
  }

  /** `adb disconnect <serial>`, best effort: nothing when the run environment isn't running. */
  async disconnect(place: AdbPlace, serial: string): Promise<void> {
    await this.adb(place, ["disconnect", serial]);
  }

  private adb(
    place: AdbPlace,
    adbArguments: readonly string[],
    input: readonly Uint8Array[] = [],
  ): Promise<StepEnd | undefined> {
    return this.step(place, ["sh", "-c", ADB_WITH_SERVER_APART, "sh", ...adbArguments], input);
  }

  private async keyOf(projectId: string): Promise<AdbKey> {
    const kept = await this.keys.find(projectId);
    if (kept !== undefined) return kept;
    return this.keys.keepFirst(await newAdbKey(projectId, this.schedule.now()));
  }

  /**
   * Runs one program where adb runs to its end, its input written then closed; undefined when the
   * environment isn't running.
   */
  private async step(
    place: AdbPlace,
    programArguments: readonly string[],
    input: readonly Uint8Array[] = [],
  ): Promise<StepEnd | undefined> {
    const process = await place.attach({ arguments: programArguments });
    if (process === undefined) return undefined;
    const output: Buffer[] = [];
    process.stdout.on("data", (chunk: Buffer) => {
      output.push(chunk);
    });
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

/** The last line the step printed that isn't blank. */
function lastLineOf(output: string): string | undefined {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .findLast((line) => line !== "");
}

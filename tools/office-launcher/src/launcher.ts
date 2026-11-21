import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { runOfficeUpdate, type Command, type UpdateCommands } from "./office-update.ts";
import { runReleaseUpdate, type ReleaseInstall } from "./release-update.ts";
import { healthUrlOf, type HealthWait } from "./service-health.ts";
import { runningService, stopService, type RunningService } from "./service-process.ts";
import { failure, takeRequest, type UpdateResult } from "./update-folder.ts";

/**
 * The exit code the service ends with to have the launcher carry out its request, an update or a
 * restart (EX_TEMPFAIL).
 */
export const UPDATE_EXIT_CODE = 75;

/** The variable telling the service where the launcher reads its update request. */
export const UPDATE_FOLDER_VARIABLE = "OFFICE_UPDATE_FOLDER";

/** The variable telling the service how it was installed, set here for a release alone. */
export const INSTALL_VARIABLE = "OFFICE_INSTALL";

/**
 * The variable The Office sets in every test instance of itself (spec §6, "Test instances"): with
 * it "true", the launcher updates and restarts nothing.
 */
export const TEST_INSTANCE_VARIABLE = "OFFICE_TEST_INSTANCE";

const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM"] as const;

/** What the launcher updates, by how The Office was installed. */
export type LauncherInstall =
  | {
      readonly mode: "checkout";
      /** `<office-data>/update`, where the service asks for the update and reads how it went. */
      readonly updateFolder: string;
      readonly repository: string;
      readonly commands: UpdateCommands;
    }
  | (ReleaseInstall & {
      readonly mode: "release";
      readonly updateFolder: string;
      readonly health?: HealthWait;
      readonly download?: (url: string) => Promise<Response>;
    })
  /** A copy that can't update itself: the service gets no update folder, so it refuses Update. */
  | { readonly mode: "not-installed" };

export interface LauncherOptions {
  readonly install: LauncherInstall;
  /** How the service starts, from `serviceDirectory`. */
  readonly service: Command;
  /** The folder the service starts in, found at each start, as an update may move it. */
  readonly serviceDirectory: () => string;
  readonly environment: NodeJS.ProcessEnv;
  readonly log: (line: string) => void;
}

/**
 * Runs the service until it ends, and gives its exit code. A service ending with
 * `UPDATE_EXIT_CODE` is updated, or only restarted when it asked for that, and started again; a
 * stop signal goes on to the service, and one coming during an update lets the update finish, so
 * the install is left whole, but runs nothing after it. The launcher's own code is the one it was
 * started with: a new version's applies from its next start. In a test instance of The Office
 * (`OFFICE_TEST_INSTANCE=true`) it updates and restarts nothing.
 */
export async function runLauncher(given: LauncherOptions): Promise<number> {
  const options = asTestInstance(given);
  let stopping = false;
  let service: RunningService | undefined;
  const forward = (signal: NodeJS.Signals): void => {
    stopping = true;
    service?.child.kill(signal);
  };
  for (const signal of FORWARDED_SIGNALS) process.on(signal, forward);
  try {
    let started: RunningService | undefined;
    for (;;) {
      service = started ?? startService(options);
      const code = await service.exited;
      service = undefined;
      if (code !== UPDATE_EXIT_CODE || stopping || options.install.mode === "not-installed") {
        return code;
      }
      started = await updateOnce(options);
      if (stopping) {
        if (started) await stopService(started);
        return 0;
      }
    }
  } finally {
    for (const signal of FORWARDED_SIGNALS) process.removeListener(signal, forward);
  }
}

/**
 * A test instance of The Office runs as a copy that can't update itself, whatever its layout: its
 * service gets no update folder, so it refuses Update and Restart, and an exit with
 * `UPDATE_EXIT_CODE` just ends the launcher, so nothing touches the instance's checkout.
 */
function asTestInstance(options: LauncherOptions): LauncherOptions {
  if (options.environment[TEST_INSTANCE_VARIABLE] !== "true") return options;
  return { ...options, install: { mode: "not-installed" } };
}

function startService(options: LauncherOptions): RunningService {
  const [program, ...args] = options.service;
  return runningService(
    spawn(program, args, {
      cwd: options.serviceDirectory(),
      stdio: "inherit",
      env: serviceEnvironment(options),
    }),
  );
}

function serviceEnvironment({ install, environment }: LauncherOptions): NodeJS.ProcessEnv {
  const variables = { ...environment };
  delete variables[UPDATE_FOLDER_VARIABLE];
  delete variables[INSTALL_VARIABLE];
  if (install.mode === "not-installed") return variables;
  mkdirSync(install.updateFolder, { recursive: true });
  variables[UPDATE_FOLDER_VARIABLE] = install.updateFolder;
  if (install.mode === "release") variables[INSTALL_VARIABLE] = "release";
  return variables;
}

/**
 * Carries out the update the service asked for, and gives the service an update started, if it
 * did. An update that throws, such as on a request the install can't carry out, is logged, and the
 * service starts as it is. A restart request installs nothing and leaves no result or log: the
 * service just starts again.
 */
async function updateOnce(options: LauncherOptions): Promise<RunningService | undefined> {
  const { install, log } = options;
  if (install.mode === "not-installed") return undefined;
  try {
    const request = takeRequest(install.updateFolder);
    if (!request) {
      log("The service asked for an update, but no request was written.");
      return undefined;
    }
    if (request.kind === "restart") {
      log("Restarting The Office, as it asked.");
      return undefined;
    }
    if (install.mode === "checkout" && request.kind === "commit") {
      logResult(log, await runOfficeUpdate(install, request.target));
      return undefined;
    }
    if (install.mode === "release" && request.kind === "release") {
      const { result, service } = await runReleaseUpdate(
        {
          ...install,
          startService: () => startService(options),
          healthUrl: () => healthUrlOf(options.environment),
        },
        request,
      );
      logResult(log, result);
      return service;
    }
    log(`The service asked for an update of a ${request.kind}, which a ${install.mode} can't do.`);
  } catch (error) {
    log(`The Office's update failed: ${failure(error)}`);
  }
  return undefined;
}

function logResult(log: (line: string) => void, result: UpdateResult): void {
  if (result.outcome === "updated") log(`Updated The Office from ${result.from} to ${result.to}.`);
  else
    log(
      `The Office's update to ${result.to} failed at ${result.failedStep}; back at ${result.from}.`,
    );
}

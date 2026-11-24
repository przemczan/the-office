import type { Logger } from "@nestjs/common";
import { readFile, writeFile } from "node:fs/promises";
import type { RunEnvironmentDefinition } from "../domain/run-environment-definition.js";
import { RunEnvironmentRefused } from "../domain/run-environment-refused.js";
import {
  fileOwnerIdsOf,
  HAND_BACK_TIMEOUT_MS,
  handBackScript,
  ROOT_USER,
} from "../domain/run-environment.js";
import {
  ContainerRuntime,
  ContainerRuntimeFailed,
  type ComposeProject,
  type StreamedOutputMask,
} from "../ports/container-runtime.js";
import { refusingOnRuntimeFailure } from "./runtime-steps.js";
import type { ServiceOwner } from "./service-owner.js";

/**
 * Where and how a checkout is given back to The Office's user: kept in a file, so the sweep after
 * a restart gives it back too.
 */
interface CheckoutHandBack {
  readonly project: ComposeProject;
  readonly service: string;
  readonly checkout: string;
  readonly logFile: string;
}

/** What a checkout's hand-over to the checks' user needs. */
export interface CheckoutToHandOver {
  /** The checkout, an absolute path, mounted at its own path in the definition's service. */
  readonly checkout: string;
  readonly logFile: string;
  readonly mask: StreamedOutputMask;
  /** The file, beside the override, that says how to give the checkout back. */
  readonly handBackFile: string;
  /** The words a stop meanwhile is refused in, such as "The Test instance was stopped.". */
  readonly stoppedWords: string;
}

/** The hand-back prints only chown's own words about the checkout's files, never a variable. */
const UNMASKED: StreamedOutputMask = {
  chunks: () => ({ next: (chunk) => chunk, end: () => new Uint8Array() }),
};

/**
 * A detached checkout's files given to the checks' user as its compose project starts, and back to
 * The Office's user before it is removed (spec §5.5, "A test instance's checkout", "Run
 * environments with a non-root Office"): what a Hosted or Build to install Test instance and an
 * Action's Project command run share.
 */
export class CheckoutHandOver {
  constructor(
    private readonly runtime: ContainerRuntime,
    private readonly serviceOwner: ServiceOwner,
    private readonly logger: Logger,
  ) {}

  /**
   * Gives every file of the checkout to the user the commands run as, as root, with the hand-back's
   * own script, so they can write it; a root checks' user, and Windows, need nothing. On a non-root
   * Office it first records how to give the checkout back. Refuses when that fails.
   */
  async toChecksUser(
    checkout: CheckoutToHandOver,
    project: ComposeProject,
    definition: RunEnvironmentDefinition,
    stopping: AbortSignal,
  ): Promise<void> {
    if (!this.serviceOwner.filesHaveOwners) return;
    if (this.serviceOwner.owner !== undefined) {
      const handBack: CheckoutHandBack = {
        project: { ...project, variables: {} },
        service: definition.service,
        checkout: checkout.checkout,
        logFile: checkout.logFile,
      };
      await writeFile(checkout.handBackFile, JSON.stringify(handBack));
    }
    const checksUser = fileOwnerIdsOf(
      await refusingOnRuntimeFailure(
        checkout.logFile,
        "The checks' user couldn't be read in the run environment.",
        () => this.runtime.userIdsOf(project, definition.service, definition.user),
      ),
    );
    if (checksUser.userId === 0) return;
    const { exitCode, endedBy } = await refusingOnRuntimeFailure(
      checkout.logFile,
      "The checkout couldn't be given to the checks' user.",
      () =>
        this.runtime.exec(
          project,
          {
            service: definition.service,
            user: ROOT_USER,
            script: handBackScript(checkout.checkout, checksUser),
            variables: {},
            mask: checkout.mask,
            timeoutMs: HAND_BACK_TIMEOUT_MS,
            signal: stopping,
          },
          checkout.logFile,
        ),
    );
    if (stopping.aborted || endedBy === "stop") {
      throw new RunEnvironmentRefused([checkout.stoppedWords], checkout.logFile);
    }
    if (endedBy === "timeout" || exitCode !== 0) {
      throw new RunEnvironmentRefused(
        [
          "The checkout couldn't be given to the checks' user.",
          endedBy === "timeout"
            ? `It didn't end within ${HAND_BACK_TIMEOUT_MS / 60_000} minutes.`
            : `It ended with the exit code ${exitCode ?? "none"}.`,
        ],
        checkout.logFile,
      );
    }
  }

  /**
   * On a non-root Office, gives every file of the checkout back to The Office's user, as root in
   * the checks' service while it still runs, so the checkout can be removed. A failure is only
   * logged: the removal goes on. `what` names the checkout's owner in the log.
   */
  async back(handBackFile: string, what: string): Promise<void> {
    const { owner } = this.serviceOwner;
    if (owner === undefined) return;
    const handBack = await handBackOf(handBackFile);
    if (handBack === undefined) return;
    try {
      const { exitCode, endedBy } = await this.runtime.exec(
        handBack.project,
        {
          service: handBack.service,
          user: ROOT_USER,
          script: handBackScript(handBack.checkout, owner),
          variables: {},
          mask: UNMASKED,
          timeoutMs: HAND_BACK_TIMEOUT_MS,
        },
        handBack.logFile,
      );
      if (endedBy !== undefined || exitCode !== 0) {
        this.logger.warn(
          `The checkout of ${what} wasn't given back: ${endedBy ?? `exit code ${exitCode ?? "none"}`}.`,
        );
      }
    } catch (error) {
      if (!(error instanceof ContainerRuntimeFailed)) throw error;
      this.logger.warn(`The checkout of ${what} wasn't given back.`, error);
    }
  }
}

async function handBackOf(file: string): Promise<CheckoutHandBack | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as CheckoutHandBack;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

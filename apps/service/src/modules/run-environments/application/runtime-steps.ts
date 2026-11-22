import type { RunEnvironmentDefinition } from "../domain/run-environment-definition.js";
import { RunEnvironmentRefused } from "../domain/run-environment-refused.js";
import { ROOT_USER } from "../domain/run-environment.js";
import {
  ContainerRuntimeFailed,
  type AttachedProcess,
  type ComposeProject,
  type ContainerRuntime,
} from "../ports/container-runtime.js";

/**
 * A program the service runs in a running run environment (a Task's, or a pairing environment),
 * its standard input and output The Office's own, as the Office device helper is (spec §2.13, "The
 * relay").
 */
export interface RunEnvironmentAttachment {
  /** The program and its arguments, run as they are, never by a shell. */
  readonly arguments: readonly string[];
  /** As the container's root instead of the checks' user, as the helper's serial mode runs. */
  readonly asRoot?: boolean;
  /**
   * Where its standard error is appended; unless given, `attached.log` in the Task's folder, or a
   * pairing environment's log file.
   */
  readonly logFile?: string;
}

/**
 * Runs a step against the runtime, its failure refused in the user's words: `reason`, then what the
 * runtime said, the output file named when there is one.
 */
export async function refusingOnRuntimeFailure<Result>(
  outputFile: string | undefined,
  reason: string,
  step: () => Promise<Result>,
): Promise<Result> {
  try {
    return await step();
  } catch (error) {
    if (!(error instanceof ContainerRuntimeFailed)) throw error;
    throw new RunEnvironmentRefused([reason, error.message], outputFile);
  }
}

/**
 * Starts the program in the definition's service of a running compose project, as the
 * definition's user (`0:0` with `asRoot`), its standard error appended to `errorFile`; a runtime
 * failure refused in words.
 */
export function attachedIn(
  runtime: ContainerRuntime,
  project: ComposeProject,
  definition: RunEnvironmentDefinition,
  attachment: RunEnvironmentAttachment,
  errorFile: string,
): Promise<AttachedProcess> {
  const user = attachment.asRoot === true ? ROOT_USER : definition.user;
  return refusingOnRuntimeFailure(
    undefined,
    "The program couldn't start in the run environment.",
    () =>
      runtime.attach(project, {
        service: definition.service,
        ...(user === undefined ? {} : { user }),
        arguments: attachment.arguments,
        errorFile: attachment.logFile ?? errorFile,
      }),
  );
}

import type { AttachedProcess, RunEnvironmentAttachment } from "../../run-environments/index.js";

/** One pairing environment, running until removed. */
export interface RunningPairingEnvironment {
  /** Starts the program in it as the checks' user; undefined once it is removed or can't. */
  attach(attachment: RunEnvironmentAttachment): Promise<AttachedProcess | undefined>;
  /** Removes it, whatever is left of it; never throws. */
  remove(): Promise<void>;
}

/** What a pairing environment is started for and from. */
export interface PairingEnvironmentToStart {
  readonly projectId: string;
  readonly projectDeviceId: string;
  /** The folder holding the base branch tip's `.devcontainer/`. */
  readonly definitionFolder: string;
  /** Where its start's output goes. */
  readonly logFile: string;
  /** Stops the start, as when its time limit runs out or the pairing is cut off. */
  readonly signal?: AbortSignal;
}

/** Starts and sweeps the pairing environments a Project device pairs in (spec §5.5). */
export abstract class PairingEnvironmentStart {
  /** Every reason it couldn't start, in the UI's words, or the environment running. */
  abstract start(
    start: PairingEnvironmentToStart,
  ): Promise<RunningPairingEnvironment | { readonly problems: readonly string[] }>;

  /** Removes every pairing environment a last run left. */
  abstract sweep(): Promise<void>;
}

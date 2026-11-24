import type { RunMask, RunVariable } from "./action-projects.js";

/** A Project command run in its own compose project. */
export interface RunInEnvironment {
  readonly runId: string;
  readonly projectId: string;
  readonly checkout: string;
  readonly commands: readonly { readonly name: string; readonly commandLine: string }[];
  /** The Project's environment with what The Office sets over it. */
  readonly environment: {
    readonly set: readonly { readonly name: string; readonly value: string }[];
    readonly unset: readonly string[];
    readonly prependPath: readonly string[];
  };
  readonly installCommand: string;
  readonly installInputs: readonly string[];
  readonly installVariables: readonly RunVariable[];
  readonly logFile: string;
  readonly mask: RunMask;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

/** How its commands ended: on the first that didn't end with 0, else on the last. */
export interface RunInEnvironmentEnd {
  readonly name: string;
  readonly exitCode: number | undefined;
  readonly endedBy?: "timeout" | "stop";
}

/**
 * Run environments' side of a command run with the Project's Run environment On (spec §5.3,
 * "Actions uses Run environments through their public interface"). An invalid `.devcontainer/` is
 * an ActionRunRefused with its problems.
 */
export abstract class CommandRunEnvironments {
  abstract run(start: RunInEnvironment): Promise<RunInEnvironmentEnd>;

  /** Removes what the run started, its compose project and volumes; nothing there is no failure. */
  abstract stop(runId: string): Promise<void>;

  /** As The Office starts: every command run's compose project left is removed. */
  abstract sweep(): Promise<void>;
}

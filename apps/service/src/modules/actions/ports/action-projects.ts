/** What a run reads of its Project. */
export interface RunProject {
  readonly id: string;
  readonly name: string;
  readonly baseBranch: string;
  readonly runEnvironmentOn: boolean;
  readonly actionsOn: boolean;
}

/** An Action as a run reads it, at its start. */
export type RunAction = {
  readonly key: string;
  readonly name: string;
  readonly leavesTheWorkstation: boolean;
} & (
  | {
      readonly kind: "project-command";
      readonly settings: {
        readonly commandKey: string;
        readonly commandsBefore: readonly string[];
        readonly timeLimitMinutes: number | null;
        /** The Project device the run holds while it runs, by its id; null for none. */
        readonly projectDeviceId: string | null;
      };
    }
  | { readonly kind: "test-target"; readonly settings: { readonly targetKey: string } }
  | {
      readonly kind: "workflow";
      readonly settings: {
        readonly file: string;
        readonly inputs: Readonly<Record<string, string>>;
      };
    }
);

/** A variable a command run gets; a Secret variable's value is masked in its log. */
export interface RunVariable {
  readonly name: string;
  readonly value: string;
  readonly secret: boolean;
}

/** The Project's environment as a command run gets it. */
export interface RunEnvironmentVariables {
  readonly set: readonly RunVariable[];
  readonly unset: readonly string[];
  readonly prependPath: readonly string[];
}

/** Hides each of the Project's Secret variables as `[secret NAME]`, in lines and in streams. */
export interface RunMask {
  mask(text: string): string;
  chunks(): { next(chunk: Uint8Array): Uint8Array; end(): Uint8Array };
}

/** What a Project command run runs with. */
export interface CommandRunSettings {
  /** The commands before it, then the command itself last, each by its name in the Project. */
  readonly commands: readonly { readonly name: string; readonly commandLine: string }[];
  /** The keys the Action names that the Project no longer has; the run fails on them. */
  readonly missingCommands: readonly string[];
  readonly timeoutMs: number;
  readonly environment: RunEnvironmentVariables;
  readonly mask: RunMask;
  readonly install: {
    readonly installCommand: string;
    readonly installInputs: readonly string[];
    readonly installVariables: readonly RunVariable[];
  };
}

/** How a command run's commands ended on the workstation. */
export interface WorkstationRunEnd {
  readonly name: string;
  readonly outcome: "passed" | "failed" | "could-not-run" | "timed-out" | "stopped";
  readonly exitCode: number | undefined;
}

/**
 * Projects' side of an Action run (spec §5.3, "Actions"): the Project and its Actions, a command
 * run's settings, a branch's fetched tip, the run's checkout and its log's path, and a command run
 * on the workstation. Every refusal is an ActionRunRefused in Projects' words; a Project that
 * isn't there an ActionRunNotFound.
 */
export abstract class ActionProjects {
  abstract projectOf(projectId: string): Promise<RunProject>;

  /** The Project's Actions, in their order. */
  abstract actionsOf(projectId: string): Promise<readonly RunAction[]>;

  /** The Action by its key; undefined when the Project has none. */
  abstract actionOf(projectId: string, key: string): Promise<RunAction | undefined>;

  abstract commandRunOf(projectId: string, key: string): Promise<CommandRunSettings>;

  /** Whether the Project still has the test target. */
  abstract hasTestTarget(projectId: string, key: string): Promise<boolean>;

  /** The branch's tip, fetched first, with its subject. */
  abstract branchTip(
    projectId: string,
    branch: string,
  ): Promise<{ readonly commit: string; readonly subject: string }>;

  abstract remoteHasBranch(projectId: string, branch: string): Promise<boolean>;

  /** Writes the commit's files into the run's own checkout; answers its folder. */
  abstract checkOut(
    projectId: string,
    runId: string,
    branch: string,
    commit: string,
  ): Promise<string>;

  abstract removeCheckout(runId: string): Promise<void>;

  /** The run's log, an absolute path beside its checkout. */
  abstract logFileOf(runId: string): string;

  abstract removeLog(runId: string): Promise<void>;

  /** The ids of the runs whose checkout is still here. */
  abstract leftoverRunIds(): Promise<readonly string[]>;

  /** Runs the commands on the workstation, in the run's checkout, appending to its log. */
  abstract runOnWorkstation(run: {
    readonly runId: string;
    readonly projectId: string;
    readonly commands: readonly { readonly name: string; readonly commandLine: string }[];
    readonly variables: readonly { readonly name: string; readonly value: string }[];
    readonly timeoutMs: number;
    readonly signal: AbortSignal;
  }): Promise<WorkstationRunEnd>;
}

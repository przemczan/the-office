import type { TargetEntryPoint } from "../domain/entry-point.js";

/** A Project's test target as the Initiative's page lists it. */
export interface ListedTarget {
  readonly key: string;
  readonly name: string;
  /** Its kind; the outlined ones aren't launched and aren't listed. */
  readonly kind: string;
  readonly entryPoint: TargetEntryPoint;
}

/** Hides the target's own Secret variables' values, as `[secret NAME]`, line by line or streamed. */
export interface InstanceMask {
  mask(text: string): string;
  chunks(): { next(chunk: Uint8Array): Uint8Array; end(): Uint8Array };
}

/** One of the target's own variables. */
export interface TargetVariable {
  readonly name: string;
  readonly value: string;
  readonly secret: boolean;
}

/** One of the Project's commands a target runs before its entry point, as the Project has it now. */
export interface CommandBefore {
  readonly key: string;
  readonly name: string;
  /** The Project's command line for it, run by a POSIX shell in the checkout. */
  readonly commandLine: string;
}

/** A Build to install build on the workstation, its Run environment Off. */
export interface WorkstationBuild {
  /** The instance's checkout, one directly inside `<office-data>/test-instances/`. */
  readonly checkout: string;
  /** The folder it runs in, relative to the checkout. */
  readonly folder: string;
  /** A POSIX shell command line, every word quoted. */
  readonly commandLine: string;
  /** The target's own variables and `OFFICE_TEST_INSTANCE`, the only ones beside the service's. */
  readonly variables: readonly TargetVariable[];
  /** Its output is appended there, masked. */
  readonly logFile: string;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

/**
 * How a workstation build ended: its exit code only when it exited by itself; `endedBy` when it
 * didn't, or couldn't run at all.
 */
export interface WorkstationBuildEnd {
  readonly exitCode: number | undefined;
  readonly endedBy: "timeout" | "stop" | "could-not-run" | undefined;
}

/** What launching a target needs, its Secret variables' values among them. */
export interface TargetLaunch {
  readonly key: string;
  readonly name: string;
  readonly kind: string;
  readonly entryPoint: TargetEntryPoint;
  /** A Hosted target's port inside its container; undefined for other kinds. */
  readonly containerPort: number | undefined;
  readonly runEnvironmentOn: boolean;
  /** A Build to install target's output file patterns, from the repository's root; else empty. */
  readonly outputPatterns: readonly string[];
  /** The target's own variables, plain and secret with a value; never the Project's. */
  readonly variables: readonly TargetVariable[];
  readonly secretsWithoutValue: readonly string[];
  /** The Project's commands run in the checkout before the entry point, in order. */
  readonly commandsBefore: readonly CommandBefore[];
  /** The keys of commands before the entry point the Project no longer has; a launch fails on one. */
  readonly missingCommands: readonly string[];
  /** A Hosted target's variable set to its port; undefined for other kinds. */
  readonly portVariable: string | undefined;
  /** The target's own Memory per service in MB; undefined when the Office-wide value applies. */
  readonly memoryMegabytes: number | undefined;
  readonly mask: InstanceMask;
}

/** What the Project's run environment image is made from, as a Task's is. */
export interface InstallSettings {
  readonly installCommand: string | undefined;
  readonly installInputs: readonly string[];
  readonly installVariables: readonly {
    readonly name: string;
    readonly value: string;
    readonly secret: boolean;
  }[];
}

/**
 * Projects' test targets and the instances' checkouts; bound to an adapter over Projects' public
 * interface. Projects' refusals come out as `TestInstanceRefused`, a missing Project as
 * `TestInstanceNotFound`.
 */
export abstract class ProjectTestTargets {
  /** The Project's test targets, in the order added. */
  abstract targetsOf(projectId: string): Promise<readonly ListedTarget[]>;

  /** Whether the Project has Test targets switched on (spec §2.1.1); false for one not there. */
  abstract testTargetsOn(projectId: string): Promise<boolean>;

  abstract runEnvironmentOn(projectId: string): Promise<boolean>;

  /** Refused when the Project has no such target, or has Test targets switched off. */
  abstract launchOf(projectId: string, key: string): Promise<TargetLaunch>;

  /** Why the target's entry point isn't one of the repository's at `commit`; empty when it is. */
  abstract entryPointProblemsAt(projectId: string, commit: string, key: string): Promise<string[]>;

  /**
   * Fetches the branch, then writes its tip's files into `folder`, one directly inside
   * `<office-data>/test-instances/`, with no `.git`; answers the commit.
   */
  abstract checkOut(projectId: string, branch: string, folder: string): Promise<{ commit: string }>;

  /** The branch's tip as the Project's repository has it, with no fetch; undefined with none. */
  abstract branchCommitOf(projectId: string, branch: string): Promise<string | undefined>;

  /** Removes a checkout, best effort. */
  abstract removeCheckout(folder: string): Promise<void>;

  abstract installSettingsOf(projectId: string): Promise<InstallSettings>;

  /** Runs a build in its checkout on the workstation, the way checks run there. */
  abstract runBuild(build: WorkstationBuild): Promise<WorkstationBuildEnd>;
}

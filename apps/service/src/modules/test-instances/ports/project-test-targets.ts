/** A test target's entry point, one of the repository's own (spec §2.12, "Entry points only"). */
export type TargetEntryPoint =
  | {
      readonly kind: "repository-file";
      readonly path: string;
      readonly arguments: readonly string[];
    }
  | {
      readonly kind: "package-script";
      readonly manifest: string;
      readonly script: string;
      readonly arguments: readonly string[];
    }
  | { readonly kind: "gradle-task"; readonly task: string; readonly arguments: readonly string[] }
  | { readonly kind: "devcontainer-service"; readonly service: string };

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

/** What launching a target needs, its Secret variables' values among them. */
export interface TargetLaunch {
  readonly key: string;
  readonly name: string;
  readonly kind: string;
  readonly entryPoint: TargetEntryPoint;
  /** A Hosted target's port inside its container; undefined for other kinds. */
  readonly containerPort: number | undefined;
  readonly runEnvironmentOn: boolean;
  /** The target's own variables, plain and secret with a value; never the Project's. */
  readonly variables: readonly { readonly name: string; readonly value: string }[];
  readonly secretsWithoutValue: readonly string[];
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

  abstract runEnvironmentOn(projectId: string): Promise<boolean>;

  /** Refused when the Project has no such target. */
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
}

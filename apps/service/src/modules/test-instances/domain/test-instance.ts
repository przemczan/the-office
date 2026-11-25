import { type StopReason, stopWords } from "./stop-reason.js";
import { TestInstanceStateChanged } from "./test-instance-events.js";

/** The kinds a Test instance may be (spec §2.12, "Kinds"). */
export type TestInstanceKind = "hosted" | "build-to-install" | "install-on-a-device";

/**
 * A Test instance's state (spec §2.12, "Test instance states"): Hosted goes Building → Running →
 * Stopped, or Failed from Building or Running; Built is Build to install's; Install on a device
 * goes Building → Installing → Installed, or Failed from either.
 */
export type TestInstanceState =
  "building" | "running" | "built" | "installing" | "installed" | "stopped" | "failed";

/**
 * The states that count toward Test instances at once (a Building build an Install on a device
 * instance launched aside, `countedTowardTheLimit`); a Hosted instance holds its Proxy port.
 */
export const ACTIVE_STATES: readonly TestInstanceState[] = ["building", "installing", "running"];

/** A Project device's kind, as Devices names it (spec §2.13). */
export type TestInstanceDeviceKind = "android-usb" | "serial-usb" | "android-wireless";

/** The Project device an Install on a device instance installs on, as it was at the launch. */
export interface TestInstanceDevice {
  readonly projectDeviceId: string;
  readonly name: string;
  readonly kind: TestInstanceDeviceKind;
}

/** The Install on a device target a build was launched for, shown "Built for <name>". */
export interface BuiltFor {
  readonly targetKey: string;
  readonly targetName: string;
}

/** Who launched it, as records keep a user: their id and their name as it was then. */
export interface LaunchedBy {
  readonly kind: "user";
  readonly user: { readonly userId: string; readonly name: string };
}

/** One launch of one test target on one branch of one Project (spec §2.12). */
export interface TestInstance {
  readonly id: string;
  /**
   * The Initiative it is linked to: the one whose branch it runs, launched from its page or on an
   * active Initiative's branch from the Project page; undefined when it is linked to none.
   */
  readonly initiativeId: string | undefined;
  readonly projectId: string;
  /**
   * The branch it runs. Undefined only on a row launched before branches were recorded, which is
   * always linked, its branch its Initiative's (`TestInstances` reads it so, in one place).
   */
  readonly branch: string | undefined;
  readonly targetKey: string;
  /** The target's name when it was launched, kept should the target be renamed or removed. */
  readonly targetName: string;
  readonly kind: TestInstanceKind;
  readonly state: TestInstanceState;
  /** The branch tip it runs; undefined until the checkout has it. */
  readonly commit: string | undefined;
  /** The Proxy port it holds while Building or Running; undefined once it has ended. */
  readonly port: number | undefined;
  /** Why it failed, in the user's words; undefined unless Failed. */
  readonly failedReason: string | undefined;
  readonly launchedBy: LaunchedBy;
  readonly launchedAt: Date;
  readonly runningAt: Date | undefined;
  readonly endedAt: Date | undefined;
  /** A Built instance's files by name, in `<office-data>/test-builds/<id>/`; empty otherwise. */
  readonly files: readonly { readonly name: string; readonly size: number }[];
  /** When a Built instance's files were removed (spec §2.12, "Kept Build to install files"). */
  readonly filesRemovedAt: Date | undefined;
  /** The Action whose run launched it, shown "Run as <Action>"; undefined when launched by hand. */
  readonly runAs: TestInstanceRunAs | undefined;
  /** An Install on a device instance's device; undefined for every other kind. */
  readonly device: TestInstanceDevice | undefined;
  /**
   * An Install on a device instance's build, the Build to install instance it launched or reused,
   * once it has one; undefined otherwise.
   */
  readonly buildInstanceId: string | undefined;
  /** A build an Install on a device instance launched: that target; undefined for every other. */
  readonly builtFor: BuiltFor | undefined;
}

/**
 * The Action a launch runs as (spec §2.15, "Action run"), named by its key and its name at the
 * launch; Test instances only keep and show it, never reading Actions.
 */
export interface TestInstanceRunAs {
  readonly actionKey: string;
  readonly actionName: string;
}

/** A change to an instance, with the event it carries; undefined when nothing would change. */
export type TestInstanceChange =
  | { readonly instance: TestInstance; readonly event: TestInstanceStateChanged | undefined }
  | undefined;

export function isActive(instance: Pick<TestInstance, "state">): boolean {
  return ACTIVE_STATES.includes(instance.state);
}

/**
 * The active instances that take a slot of Test instances at once: every one but a build an
 * active Install on a device instance launched, as the two count as one (spec §2.12, "Its build").
 */
export function countedTowardTheLimit(active: readonly TestInstance[]): TestInstance[] {
  const launchedByAnInstall = new Set(
    active.flatMap(({ kind, buildInstanceId }) =>
      kind === "install-on-a-device" && buildInstanceId !== undefined ? [buildInstanceId] : [],
    ),
  );
  return active.filter(({ id }) => !launchedByAnInstall.has(id));
}

/**
 * A new instance, Building: a Hosted one on its Proxy port, a Build to install one on none (with
 * the Install on a device target it was launched for, if any), an Install on a device one with
 * its device.
 */
export function launchedInstance(
  given: {
    readonly id: string;
    readonly initiativeId: string | undefined;
    readonly projectId: string;
    readonly branch: string;
    readonly targetKey: string;
    readonly targetName: string;
    readonly launchedBy: LaunchedBy;
    readonly at: Date;
    readonly runAs?: TestInstanceRunAs | undefined;
  } & (
    | { readonly kind: "hosted"; readonly port: number }
    | { readonly kind: "build-to-install"; readonly builtFor?: BuiltFor | undefined }
    | { readonly kind: "install-on-a-device"; readonly device: TestInstanceDevice }
  ),
): TestInstance {
  return {
    id: given.id,
    initiativeId: given.initiativeId,
    projectId: given.projectId,
    branch: given.branch,
    targetKey: given.targetKey,
    targetName: given.targetName,
    kind: given.kind,
    state: "building",
    commit: undefined,
    port: given.kind === "hosted" ? given.port : undefined,
    failedReason: undefined,
    launchedBy: given.launchedBy,
    launchedAt: given.at,
    runningAt: undefined,
    endedAt: undefined,
    files: [],
    filesRemovedAt: undefined,
    runAs: given.runAs,
    device: given.kind === "install-on-a-device" ? given.device : undefined,
    buildInstanceId: undefined,
    builtFor: given.kind === "build-to-install" ? given.builtFor : undefined,
  };
}

/** The commit its checkout has, recorded while it is Building. */
export function withCommit(instance: TestInstance, commit: string): TestInstanceChange {
  if (instance.state !== "building" || instance.commit === commit) return undefined;
  return { instance: { ...instance, commit }, event: undefined };
}

/** An Install on a device instance's build, launched while it is Building. */
export function withBuild(instance: TestInstance, buildInstanceId: string): TestInstanceChange {
  if (instance.kind !== "install-on-a-device" || instance.state !== "building") return undefined;
  return { instance: { ...instance, buildInstanceId }, event: undefined };
}

/** An Install on a device instance Building → Installing the files of `buildInstanceId`. */
export function startedInstalling(
  instance: TestInstance,
  buildInstanceId: string,
): TestInstanceChange {
  if (instance.kind !== "install-on-a-device" || instance.state !== "building") return undefined;
  return moved(instance, { ...instance, state: "installing", buildInstanceId });
}

/** An Install on a device instance Installing → Installed: the app is on the device. */
export function installed(instance: TestInstance, at: Date): TestInstanceChange {
  if (instance.state !== "installing") return undefined;
  return moved(instance, { ...instance, state: "installed", endedAt: at });
}

/** Building → Running, once its app answers. */
export function startedRunning(instance: TestInstance, at: Date): TestInstanceChange {
  if (instance.state !== "building") return undefined;
  return moved(instance, { ...instance, state: "running", runningAt: at });
}

/** A Build to install instance Building → Built, with the files it made. */
export function built(
  instance: TestInstance,
  files: readonly { readonly name: string; readonly size: number }[],
  at: Date,
): TestInstanceChange {
  if (instance.kind !== "build-to-install" || instance.state !== "building") return undefined;
  return moved(instance, { ...instance, state: "built", files, endedAt: at });
}

/** A Built instance's files removed; its row and log stay, saying so. */
export function filesRemoved(instance: TestInstance, at: Date): TestInstanceChange {
  if (instance.state !== "built" || instance.filesRemovedAt !== undefined) return undefined;
  return { instance: { ...instance, filesRemovedAt: at }, event: undefined };
}

/**
 * Building or Running → Stopped, its port freed. A Build to install or Install on a device instance
 * has no Stopped: it fails with how it stopped (spec §2.12, "When an instance stops"). The event
 * says how it was stopped either way.
 */
export function stopped(instance: TestInstance, reason: StopReason, at: Date): TestInstanceChange {
  if (instance.kind !== "hosted") {
    return failedWith(instance, stopWords(reason), at, reason.kind);
  }
  if (!isActive(instance)) return undefined;
  return moved(
    instance,
    { ...instance, state: "stopped", port: undefined, endedAt: at },
    reason.kind,
  );
}

/** Building, Installing or Running → Failed, saying why, its port freed. */
export function failed(instance: TestInstance, reason: string, at: Date): TestInstanceChange {
  return failedWith(instance, reason, at, undefined);
}

function failedWith(
  instance: TestInstance,
  reason: string,
  at: Date,
  stoppedBy: StopReason["kind"] | undefined,
): TestInstanceChange {
  if (!isActive(instance)) return undefined;
  return moved(
    instance,
    { ...instance, state: "failed", port: undefined, failedReason: reason, endedAt: at },
    stoppedBy,
  );
}

function moved(
  before: TestInstance,
  after: TestInstance,
  stoppedBy: StopReason["kind"] | undefined = undefined,
): TestInstanceChange {
  return {
    instance: after,
    event: new TestInstanceStateChanged(
      after.id,
      after.projectId,
      after.initiativeId,
      before.state,
      after.state,
      before.port,
      after.targetName,
      after.branch,
      after.failedReason,
      stoppedBy,
      after.files.map((file) => file.name),
      after.device?.name,
      after.builtFor?.targetName,
    ),
  };
}

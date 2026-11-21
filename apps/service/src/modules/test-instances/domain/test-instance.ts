import { TestInstanceStateChanged } from "./test-instance-events.js";

/** The kinds a Test instance may be (spec §2.12, "Kinds"). */
export type TestInstanceKind = "hosted" | "build-to-install";

/**
 * A Test instance's state (spec §2.12, "Test instance states"): Hosted goes Building → Running →
 * Stopped, or Failed from Building or Running; Built is Build to install's.
 */
export type TestInstanceState = "building" | "running" | "built" | "stopped" | "failed";

/** The states that count toward Test instances at once; a Hosted instance holds its Proxy port. */
export const ACTIVE_STATES: readonly TestInstanceState[] = ["building", "running"];

/** Who launched it, as records keep a user: their id and their name as it was then. */
export interface LaunchedBy {
  readonly kind: "user";
  readonly user: { readonly userId: string; readonly name: string };
}

/** One launch of one test target on one Initiative's branch in one Project (spec §2.12). */
export interface TestInstance {
  readonly id: string;
  readonly initiativeId: string;
  readonly projectId: string;
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
}

/** A change to an instance, with the event it carries; undefined when nothing would change. */
export type TestInstanceChange =
  | { readonly instance: TestInstance; readonly event: TestInstanceStateChanged | undefined }
  | undefined;

export function isActive(instance: Pick<TestInstance, "state">): boolean {
  return ACTIVE_STATES.includes(instance.state);
}

/** A new instance, Building: a Hosted one on its Proxy port, a Build to install one on none. */
export function launchedInstance(
  given: {
    readonly id: string;
    readonly initiativeId: string;
    readonly projectId: string;
    readonly targetKey: string;
    readonly targetName: string;
    readonly launchedBy: LaunchedBy;
    readonly at: Date;
  } & ({ readonly kind: "hosted"; readonly port: number } | { readonly kind: "build-to-install" }),
): TestInstance {
  return {
    id: given.id,
    initiativeId: given.initiativeId,
    projectId: given.projectId,
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
  };
}

/** The commit its checkout has, recorded while it is Building. */
export function withCommit(instance: TestInstance, commit: string): TestInstanceChange {
  if (instance.state !== "building" || instance.commit === commit) return undefined;
  return { instance: { ...instance, commit }, event: undefined };
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
 * Building or Running → Stopped, its port freed. A Build to install instance has no Stopped: it
 * fails with how it stopped (spec §2.12, "When an instance stops").
 */
export function stopped(instance: TestInstance, words: string, at: Date): TestInstanceChange {
  if (instance.kind === "build-to-install") return failed(instance, words, at);
  if (!isActive(instance)) return undefined;
  return moved(instance, { ...instance, state: "stopped", port: undefined, endedAt: at });
}

/** Building or Running → Failed, saying why, its port freed. */
export function failed(instance: TestInstance, reason: string, at: Date): TestInstanceChange {
  if (!isActive(instance)) return undefined;
  return moved(instance, {
    ...instance,
    state: "failed",
    port: undefined,
    failedReason: reason,
    endedAt: at,
  });
}

function moved(before: TestInstance, after: TestInstance): TestInstanceChange {
  return {
    instance: after,
    event: new TestInstanceStateChanged(
      after.id,
      after.initiativeId,
      before.state,
      after.state,
      before.port,
    ),
  };
}

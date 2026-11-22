import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { StopReason } from "./stop-reason.js";
import type { TestInstanceState } from "./test-instance.js";

/**
 * A test target was launched: its instance is Building, a Hosted one on its Proxy port `port`; a
 * Build to install one holds none.
 */
export class TestInstanceLaunched extends DomainEvent {
  constructor(
    readonly instanceId: string,
    readonly projectId: string,
    /** Its Initiative; undefined when it is linked to none. */
    readonly initiativeId: string | undefined,
    readonly port: number | undefined,
  ) {
    super();
  }
}

/**
 * An instance moved from one state to another (spec §2.12, "Test instance states"). `port` is the
 * Proxy port it held as it moved: the proxy opens it on Running and closes it on Stopped or Failed.
 * It carries what a Notification of the move says (spec §2.7, "Test instance Outcomes").
 */
export class TestInstanceStateChanged extends DomainEvent {
  constructor(
    readonly instanceId: string,
    readonly projectId: string,
    /** Its Initiative; undefined when it is linked to none. */
    readonly initiativeId: string | undefined,
    readonly from: TestInstanceState,
    readonly to: TestInstanceState,
    readonly port: number | undefined,
    readonly targetName: string,
    /** Undefined only on a row launched before branches were recorded, always linked. */
    readonly branch: string | undefined,
    /** Why it failed, in the user's words; undefined unless it moved to Failed. */
    readonly failedReason: string | undefined,
    /** How it was stopped, when a stop moved it; undefined otherwise. */
    readonly stoppedBy: StopReason["kind"] | undefined,
    /** A Built instance's files by name; empty otherwise. */
    readonly files: readonly string[],
  ) {
    super();
  }
}

/** Its checkout has the commit it runs, which the Initiative's page and the Project page show. */
export class TestInstanceCommitRecorded extends DomainEvent {
  constructor(
    readonly instanceId: string,
    readonly projectId: string,
    /** Its Initiative; undefined when it is linked to none. */
    readonly initiativeId: string | undefined,
    readonly commit: string,
  ) {
    super();
  }
}

/** A Built instance's files were removed (spec §2.12, "Kept Build to install files"). */
export class TestInstanceFilesRemoved extends DomainEvent {
  constructor(
    readonly instanceId: string,
    readonly projectId: string,
    /** Its Initiative; undefined when it is linked to none. */
    readonly initiativeId: string | undefined,
  ) {
    super();
  }
}

/** The Test instances limits changed (Settings › Office limits). */
export class TestInstanceSettingsChanged extends DomainEvent {}

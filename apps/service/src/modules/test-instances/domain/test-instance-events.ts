import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { TestInstanceState } from "./test-instance.js";

/** A test target was launched: its instance is Building on `port`. */
export class TestInstanceLaunched extends DomainEvent {
  constructor(
    readonly instanceId: string,
    readonly initiativeId: string,
    readonly port: number,
  ) {
    super();
  }
}

/**
 * An instance moved from one state to another (spec §2.12, "Test instance states"). `port` is the
 * Proxy port it held as it moved: the proxy opens it on Running and closes it on Stopped or Failed.
 */
export class TestInstanceStateChanged extends DomainEvent {
  constructor(
    readonly instanceId: string,
    readonly initiativeId: string,
    readonly from: TestInstanceState,
    readonly to: TestInstanceState,
    readonly port: number | undefined,
  ) {
    super();
  }
}

/** Its checkout has the commit it runs, which the Initiative's page shows. */
export class TestInstanceCommitRecorded extends DomainEvent {
  constructor(
    readonly instanceId: string,
    readonly initiativeId: string,
    readonly commit: string,
  ) {
    super();
  }
}

/** The Test instances limits changed (Settings › Office limits). */
export class TestInstanceSettingsChanged extends DomainEvent {}

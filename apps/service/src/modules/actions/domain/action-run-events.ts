import { DomainEvent } from "../../../platform/events/domain-event.js";
import type {
  ActionRunKind,
  ActionRunOutcome,
  ActionRunStatus,
  ActionRunStopReason,
} from "./action-run.js";

/** What every Action run event names: the run, its Action and what it ran from. */
interface ActionRunNamed {
  readonly runId: string;
  readonly projectId: string;
  readonly actionKey: string;
  /** The Action's name at the run's start. */
  readonly actionName: string;
  readonly kind: ActionRunKind;
  /** The branch it runs from. */
  readonly branch: string;
}

/** An Action run started: Running, a Test target run Building, a Workflow run Starting. */
export class ActionRunStarted extends DomainEvent implements ActionRunNamed {
  constructor(
    readonly runId: string,
    readonly projectId: string,
    readonly actionKey: string,
    readonly actionName: string,
    readonly kind: ActionRunKind,
    readonly branch: string,
    /** Who started it. */
    readonly startedBy: { readonly userId: string; readonly name: string },
  ) {
    super();
  }
}

/**
 * An Action run moved from one state to another (spec §2.15, "States"), carrying what an Outcome
 * Notification says (spec §2.7, "Action run Outcomes"): `outcome` once it ended, and why it Failed
 * or was Stopped. A Test target run's moves follow its test instance's, which raises the Outcome.
 */
export class ActionRunStateChanged extends DomainEvent implements ActionRunNamed {
  constructor(
    readonly runId: string,
    readonly projectId: string,
    readonly actionKey: string,
    readonly actionName: string,
    readonly kind: ActionRunKind,
    readonly branch: string,
    readonly from: ActionRunStatus["state"],
    readonly to: ActionRunStatus["state"],
    /** Undefined while it runs on. */
    readonly outcome: ActionRunOutcome | undefined,
    /** Why it Failed or was Stopped, in the user's words; undefined otherwise. */
    readonly endedBecause: string | undefined,
    /** How a stop ended it; undefined unless a stop did. */
    readonly stoppedBy: ActionRunStopReason["kind"] | undefined,
  ) {
    super();
  }
}

/** Something else on a run changed that its History shows: its commit, its CI run, its note. */
export class ActionRunChanged extends DomainEvent {
  constructor(
    readonly runId: string,
    readonly projectId: string,
    readonly actionKey: string,
  ) {
    super();
  }
}

/** Runs of an Action were removed with their logs: past the kept, or with their Action. */
export class ActionRunsRemoved extends DomainEvent {
  constructor(
    readonly projectId: string,
    readonly actionKey: string,
    readonly runIds: readonly string[],
  ) {
    super();
  }
}

/** Actions at once changed (Settings › Office limits). */
export class ActionSettingsChanged extends DomainEvent {}

import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { StageOutcomeStatus } from "./stage-run.js";

/** One of a started Task's Stages began a run. */
export class StageRunStarted extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly runId: string,
    readonly stageKey: string,
  ) {
    super();
  }
}

/** A Stage run ended done, needing a Decision, or failed. */
export class StageRunEnded extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly runId: string,
    readonly stageKey: string,
    readonly status: StageOutcomeStatus,
  ) {
    super();
  }
}

/**
 * The user stopped a run that could no longer be interrupted, such as a Script Stage's command: it
 * ran to its end, and the Task is held after it, as a Pause holds it.
 */
export class StopHeldAsPause extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly runId: string,
    readonly stageKey: string,
  ) {
    super();
  }
}

/** An optional Stage was skipped, the Definition of Done being already reported met. */
export class StageSkipped extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly runId: string,
    readonly stageKey: string,
  ) {
    super();
  }
}

/**
 * The Task's tokens reached a Stage's budget before an engine call: the Task waits on the user's
 * answer to The Office's Decision to raise it.
 */
export class BudgetReached extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly stageKey: string,
    readonly used: number,
    readonly budget: number,
  ) {
    super();
  }
}

/** A failed Stage's loop went back to an earlier Stage, with the error for that Stage's Brief. */
export class WentBackToStage extends DomainEvent {
  constructor(
    readonly taskId: string,
    /** The failed Stage, which owns the loop. */
    readonly fromStageKey: string,
    readonly toStageKey: string,
    readonly round: number,
    readonly rounds: number,
  ) {
    super();
  }
}

/**
 * A Stage failed with no retries left: it has no loop, or its loop went back as many times as it
 * may. The Task waits on the answer to The Office's Decision: the user's, or first that of the
 * Consultant it is put to (`putTo`, by the key of their Role), such as the CTO (spec §2.3).
 */
export class NoRetriesLeft extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly stageKey: string,
    readonly error: string,
    readonly putTo: string | undefined,
  ) {
    super();
  }
}

/**
 * Every Stage ended, but the Definition of Done isn't reported met: the Task waits on the user's
 * answer to The Office's Decision instead of being Done.
 */
export class DefinitionOfDoneNotMet extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly unmet: readonly string[],
  ) {
    super();
  }
}

/** The Task reached a Gate: it waits for the user to look at the work so far. */
export class GateReached extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly runId: string,
    readonly stageKey: string,
  ) {
    super();
  }
}

/** The user let the work continue past the Gate. */
export class GateContinued extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly stageKey: string,
  ) {
    super();
  }
}

/** The user sent the work back from the Gate to an earlier Stage, with their feedback. */
export class SentBackFromGate extends DomainEvent {
  constructor(
    readonly taskId: string,
    /** The Gate's key. */
    readonly fromStageKey: string,
    readonly toStageKey: string,
  ) {
    super();
  }
}

/** The user dropped the Task at the Gate. */
export class GateDropped extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly stageKey: string,
  ) {
    super();
  }
}

/** Every one of the Task's Stages ended, with the Definition of Done met or called met. */
export class PipelineCompleted extends DomainEvent {
  constructor(readonly taskId: string) {
    super();
  }
}

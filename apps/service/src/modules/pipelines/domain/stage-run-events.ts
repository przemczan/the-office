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
 * may. The Task waits on the user's answer to The Office's Decision.
 */
export class NoRetriesLeft extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly stageKey: string,
    readonly error: string,
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

/** Every one of the Task's Stages ended, with the Definition of Done met or called met. */
export class PipelineCompleted extends DomainEvent {
  constructor(readonly taskId: string) {
    super();
  }
}

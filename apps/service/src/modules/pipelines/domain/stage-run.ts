import type { StageCommandRun } from "./stage-command-run.js";

/** The option an Agent recommends to the user, by its place among the options, and why. */
export interface StageRecommendation {
  readonly option: number;
  readonly reason: string;
}

/** What an Agent asks the user when its Stage needs a Decision (spec §2.4). */
export interface StageDecision {
  readonly question: string;
  /** What the user needs to know to decide, as the Agent found it. */
  readonly context: string;
  readonly options: readonly string[];
  readonly recommendation: StageRecommendation;
}

/**
 * How a Stage run ends (spec §2.3), with what the next Stage or the user needs from it. An Agent
 * Stage's also carries its Handover note (spec §2.5), which the next Brief hands on.
 */
export type StageOutcome = (
  | {
      readonly status: "done";
      readonly summary: string;
      /**
       * The Definition of Done statements an Agent Stage reports its work now meets, by their
       * numbers in its Brief, from 1. Undefined for a Script Stage, which reports none.
       */
      readonly definitionOfDoneMet?: readonly number[];
    }
  | ({ readonly status: "needs-decision" } & StageDecision)
  | { readonly status: "failed"; readonly error: string }
) & { readonly handoverNote?: string };

export type StageOutcomeStatus = StageOutcome["status"];

/**
 * The failure an on-failure loop went back with, which the next run of the Stage it went back to
 * carries into its Brief.
 */
export interface CarriedFailure {
  /** The key of the Stage that failed and owns the loop. */
  readonly stageKey: string;
  readonly error: string;
  /** Which time the loop goes back, from 1. */
  readonly round: number;
  /** How many times the loop may go back. */
  readonly rounds: number;
  /** What the user said to do differently this round, when they gave it in a Decision. */
  readonly guidance?: string;
}

/**
 * Why the walk asks the user (spec §2.3): an Agent's own question, a Stage that failed with no
 * retries left, or a Pipeline that ended with the Definition of Done not reported met.
 */
export type StageDecisionKind = "agent" | "no-retries-left" | "definition-of-done";

/** What the user's answer to a Decision lets the walk do. */
export type WalkAnswer =
  /** The Agent's question is answered: its Stage runs again, with the answer in its Brief. */
  | { readonly kind: "answered" }
  /** The failed Stage's loop may go back this many more times. */
  | { readonly kind: "more-rounds"; readonly rounds: number }
  /** One more round, with what the user said to do differently, if anything. */
  | { readonly kind: "one-more-round"; readonly guidance: string | undefined }
  /** The walk goes on past the failed Stage; its failure is recorded as an accepted issue. */
  | { readonly kind: "accept-issues" }
  /** The Task is Done although the Definition of Done isn't reported met. */
  | { readonly kind: "mark-done" }
  | { readonly kind: "drop" };

/** A Decision the walk opened on a run, kept as data so the walk can replay its answer. */
export interface StageRunDecision {
  /** The Decision's id, as Conversations keeps it. */
  readonly id: string;
  readonly kind: StageDecisionKind;
  /** What each of the Decision's options does, in the order it lists them. */
  readonly options: readonly WalkAnswer[];
  /** Undefined while it waits on the user. */
  readonly answer: WalkAnswer | undefined;
}

/**
 * One run of one of a Task's Stages. It owns that run's state, so nothing about a Stage's work
 * accretes on the Task or on the walk (research §12).
 */
export interface StageRun {
  readonly id: string;
  readonly taskId: string;
  readonly stageKey: string;
  /** Its place among the Task's Stage runs, from 1. */
  readonly number: number;
  readonly carriedFailure: CarriedFailure | undefined;
  /** The Stage Thread an Agent Stage's run works in, once it has one. */
  readonly threadId: string | undefined;
  /**
   * The commit The Office left the Task's branch at after the run: its commit of the Stage's work,
   * or where the branch was when the Stage changed nothing or changed git itself. The next Agent
   * Stage expects HEAD there. Undefined for a run that leaves git as it was.
   */
  readonly headCommit: string | undefined;
  /** The Project commands The Office ran for the run, in order; none when it ran none. */
  readonly commandRuns: readonly StageCommandRun[];
  /** The Decisions the walk opened on the run, at most one of each kind. */
  readonly decisions: readonly StageRunDecision[];
  /** Undefined while the Stage runs. */
  readonly outcome: StageOutcome | undefined;
  readonly startedAt: Date;
  readonly endedAt: Date | undefined;
}

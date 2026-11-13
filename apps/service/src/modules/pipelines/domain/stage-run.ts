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

/** A Definition of Done statement an Agent can't verify where it works, by its number from 1. */
export interface OutOfReachStatement {
  readonly statement: number;
  readonly why: string;
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
      /**
       * The statements the Agent says it can't verify where it works, with why (Out of reach); none
       * listed leaves it undefined.
       */
      readonly definitionOfDoneOutOfReach?: readonly OutOfReachStatement[];
      /** The pull request a Publish opened. Undefined on runs stored before it was kept. */
      readonly pullRequestUrl?: string;
      /** Set on an optional Stage's run recorded as skipped, which ran nothing. */
      readonly skipped?: true;
    }
  | ({ readonly status: "needs-decision" } & StageDecision)
  | {
      readonly status: "failed";
      readonly error: string;
      /** Set when the run stopped because the Task's tokens reached the Stage's budget. */
      readonly budgetReached?: BudgetReached;
      /** Set when The Office interrupted the run: its Stage runs again, never counted as a failure. */
      readonly interrupted?: StageInterruption;
      /**
       * Set on a run The Office recorded without starting it, as it found it had restarted
       * between Stages: the Stage starts only once the user says so.
       */
      readonly notStarted?: true;
      /**
       * Set on a run the user paused, or the fire alarm held, whose Agent's turn The Office cut
       * short, as it shut down or once the alarm's hard stop came: its edits stay, maybe half-done
       * (the user's answer of 2026-10-26).
       */
      readonly cutShort?: true;
      /**
       * Set on a Publish run that found the Task's branch conflicts with the base branch, which
       * goes to Resolve rather than going back (spec §2.3, "Conflicts at Publish").
       */
      readonly baseMoved?: BaseMoved;
      /**
       * Set on a run The Office refused as it found the branch moved somewhere other than along
       * the base: the user is asked, and no round goes (spec §2.3).
       */
      readonly branchMoved?: true;
      /**
       * Set on a run held as its engine refused a turn for a used-up usage window (spec 2.3): which
       * message it refused, for the Stage to be sent again as it resumes.
       */
      readonly refused?: RefusedTurn;
    }
) & { readonly handoverNote?: string };

/**
 * A turn of the Stage's Agent the engine refused because a usage window of its account was used up
 * (spec 2.1, 2.3): no failure, the Stage is held until the reset and sent the message again.
 */
export interface RefusedTurn {
  /** What the refused turn answered: the Stage's work, or The Office's correction of its result. */
  readonly message: "work" | "correction";
  /** For a refused correction, the problems it named, which go with it again. */
  readonly problems?: string;
  /**
   * Whether the refused turn left a session to go on in: not when it was the first of a session
   * the Stage began, which then holds nothing but the refused work, so the Stage begins anew.
   */
  readonly sessionLeft: boolean;
  /** The engine that refused it, by its name at the time. */
  readonly engineName: string;
  /** The used-up window as the user reads it, such as "5-hour window". */
  readonly windowWords: string;
  /** When the window resets, as an ISO time: the run is kept as JSON. */
  readonly resetsAt: string;
}

/**
 * Why The Office interrupted a run (spec §2.4): the user's Stop, which stops the Agent's turn now
 * and discards the Stage's uncommitted edits, or their Pause, which holds the run once the turn
 * ends and keeps them; either way its Stage runs again once the user resumes the Task. The fire
 * alarm (spec §2.8) holds it as a Pause does, but stops its Project commands at once, so a Script
 * Stage stops then; its Stage runs again after the all clear. Or The Office restarting during the
 * Stage, which ends it as Stop does, and stops its Project commands too; its Stage runs again only
 * once the user says so in a Decision. Or the engine refusing the Agent's turn for a used-up usage
 * window, which holds it as a Pause does until the window resets (spec 2.3).
 */
export type StageInterruption = "stop" | "pause" | "alarm" | "restart" | "usage-window";

/**
 * What can be asked of a running Stage run: the user's Pause or Stop, the fire alarm, or the Stage
 * runner itself once the engine refused a turn for a used-up usage window (spec 2.3).
 */
export type AskedInterruption = Extract<
  StageInterruption,
  "stop" | "pause" | "alarm" | "usage-window"
>;

/** The base branch moved on since the Task's branch left it, so Publish can't take the branch. */
export interface BaseMoved {
  /** The files a merge would conflict in; none when only a fast-forward can't take it. */
  readonly conflictedFiles: readonly string[];
}

/** The Task's tokens so far against the Stage's budget, when they reached it. */
export interface BudgetReached {
  readonly used: number;
  readonly budget: number;
}

/**
 * How an Agent Stage's session began, as the Context policy decided (spec §2.5): the previous
 * Stage's session resumed, a fresh one for the same person, or a hand-off to another Role.
 */
export type StageSessionMove = "resume" | "fresh" | "hand-off";

/** A run's tokens over all its engine calls, split as the engine reports them. */
export interface StageTokens {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheCreation: number;
}

export const NO_STAGE_TOKENS: StageTokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };

export function addTokens(total: StageTokens, more: StageTokens): StageTokens {
  return {
    input: total.input + more.input,
    output: total.output + more.output,
    cacheRead: total.cacheRead + more.cacheRead,
    cacheCreation: total.cacheCreation + more.cacheCreation,
  };
}

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
  /** The Consultant whose words the guidance is, by the key of their Role; undefined for the user. */
  readonly guidedBy?: string;
}

/**
 * What the user did at a Gate (spec §2.3): let the work continue, with notes every later Agent Stage
 * is briefed with or none, send it back with feedback to an earlier Agent Stage, or drop the Task.
 */
export type GateAction =
  | { readonly kind: "continue"; readonly feedback?: string }
  | { readonly kind: "send-back"; readonly stageKey: string; readonly feedback: string }
  | { readonly kind: "drop" };

/**
 * The feedback a Gate sent the work back with, which the run of the Stage it went back to carries
 * into its Brief. It is no failure, and uses no round of any loop.
 */
export interface SentBack {
  /** The key of the Gate the user sent the work back from. */
  readonly gateKey: string;
  readonly feedback: string;
}

/**
 * Why the walk asks the user (spec §2.3): an Agent's own question, a Stage that failed with no
 * retries left, the Task's tokens reaching a Stage's budget, a Pipeline that ended with the
 * Definition of Done not reported met, a Stage The Office restarted during (spec §2.4), a Publish
 * that found the Task's branch no longer applies cleanly on the base branch, or a branch moved
 * outside The Office.
 */
export type StageDecisionKind =
  | "agent"
  | "no-retries-left"
  | "budget"
  | "definition-of-done"
  | "restart"
  | "base-moved"
  | "branch-moved";

/** What the user's answer to a Decision lets the walk do. */
export type WalkAnswer =
  /** The Agent's question is answered, in these words: its Stage runs again with them. */
  | { readonly kind: "answered"; readonly answer: string }
  /** The failed Stage's loop may go back this many more times. */
  | { readonly kind: "more-rounds"; readonly rounds: number }
  /**
   * One more round, with what the user said to do differently, if anything, or the Consultant The
   * Office put the Decision to first (`guidedBy`, by the key of their Role).
   */
  | {
      readonly kind: "one-more-round";
      readonly guidance: string | undefined;
      readonly guidedBy?: string;
    }
  /** The walk goes on past the failed Stage; its failure is recorded as an accepted issue. */
  | { readonly kind: "accept-issues" }
  /** The Task is Done although the Definition of Done isn't reported met. */
  | { readonly kind: "mark-done" }
  /** The Stage's budget grows by this many tokens, and the Stage runs again. */
  | { readonly kind: "raise-budget"; readonly tokens: number }
  /** The user resolved the conflict Resolve gave up on in the worktree: The Office commits it. */
  | { readonly kind: "resolved-in-worktree" }
  /** The Stage runs from the branch as it is now, guided by the user's words, if any. */
  | { readonly kind: "keep-branch"; readonly guidance: string | undefined }
  | { readonly kind: "drop" };

/**
 * A Decision on a run, kept as data so the walk can replay its answer: the Agent's own, which it
 * opened with an Office tool, or one the walk opened.
 */
export type StageRunDecision = AgentRunDecision | WalkRunDecision;

interface RunDecisionFields {
  /** The Decision's id, as Conversations keeps it. */
  readonly id: string;
  /** What each of the Decision's options does, in the order it lists them. */
  readonly options: readonly WalkAnswer[];
  /** Undefined while it waits on the user. */
  readonly answer: WalkAnswer | undefined;
}

/** The Agent's own question, whose answer goes with its Stage's next run. */
export interface AgentRunDecision extends RunDecisionFields {
  readonly kind: "agent";
  readonly question: string;
}

/** A Decision the walk opened (spec §2.3): The Office asks. */
export interface WalkRunDecision extends RunDecisionFields {
  readonly kind: WalkDecisionKind;
}

/** What the walk itself asks about: every Decision kind but the Agent's own. */
export type WalkDecisionKind = Exclude<StageDecisionKind, "agent">;

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
  /** The feedback a Gate sent the work back to this Stage with, when it did. */
  readonly sentBack: SentBack | undefined;
  /** The Stage Thread an Agent Stage's run works in, once it has one. */
  readonly threadId: string | undefined;
  /** How the run's session began; undefined for a run that opened none. */
  readonly session: StageSessionMove | undefined;
  /**
   * The commit The Office left the Task's branch at after the run: its commit of the Stage's work,
   * or where the branch was when the Stage changed nothing or changed git itself. The next Agent
   * Stage expects HEAD there. Undefined for a run that leaves git as it was.
   */
  readonly headCommit: string | undefined;
  /** The Project commands The Office ran for the run, in order; none when it ran none. */
  readonly commandRuns: readonly StageCommandRun[];
  /**
   * The engine the run's session ran on, by its id and its name at the time, and the model, by its
   * id there. Each undefined for a run that opened none, and for runs kept before they were
   * recorded; the name also for runs kept before it was.
   */
  readonly engineId: string | undefined;
  readonly engineName: string | undefined;
  readonly model: string | undefined;
  /** Its engine calls' tokens; none for a run that made none. */
  readonly tokens: StageTokens;
  /** The Decisions the walk opened on the run, at most one of each kind. */
  readonly decisions: readonly StageRunDecision[];
  /**
   * What the user, or the fire alarm, asked of the run while it ran, the strongest kept, so a start
   * after a crash honours it: a Stop discards the run's edits, a Pause or the alarm keeps them.
   * Undefined while nobody asked.
   */
  readonly heldBy: AskedInterruption | undefined;
  /**
   * What the user did at a Gate's run, which ends as the Task reaches the Gate and waits for it.
   * Undefined while the Gate waits, and for every other kind's run.
   */
  readonly gateAction: GateAction | undefined;
  /** Undefined while the Stage runs. */
  readonly outcome: StageOutcome | undefined;
  /**
   * Since when a Script Stage's run waits for a free run environment, every one Run environments at
   * once allows being in use; undefined while it doesn't, and once its command starts.
   */
  readonly waitingSince: Date | undefined;
  readonly startedAt: Date;
  readonly endedAt: Date | undefined;
}

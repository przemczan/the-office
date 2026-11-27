import type { StageCommandRun } from "./stage-command-run.js";
import type { PublishResult } from "./publish-result.js";

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
       * The statements an earlier Stage reported met that the work no longer meets, such as a
       * regression found in review, which takes them back; none listed leaves it undefined, as do
       * runs stored before reports counted across Stages.
       */
      readonly definitionOfDoneNoLongerMet?: readonly number[];
      /**
       * The statements the Agent says it can't verify where it works, with why (Out of reach); none
       * listed leaves it undefined.
       */
      readonly definitionOfDoneOutOfReach?: readonly OutOfReachStatement[];
      /** The pull request a Publish opened. Undefined on runs stored before it was kept. */
      readonly pullRequestUrl?: string;
      /**
       * A Publish Stage's result, Published or Nothing to publish; undefined for any other run, and
       * on a Publish run stored before results were kept. Read it through `publishResultOf`.
       */
      readonly publishResult?: PublishResult;
      /**
       * Set on a run recorded as skipped, which ran nothing: an optional Stage's, as the previous
       * release recorded them.
       */
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
      /** The user whose Pause or Stop interrupted it, when one did since users exist. */
      readonly heldByUser?: HoldingUser;
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
       * Set on a Publish run that found the Task's branch conflicts with the base branch: its
       * Conflict result, which takes the Publish Stage's Conflict route (spec §2.3.4, "Publish's
       * results").
       */
      readonly baseMoved?: BaseMoved;
      /**
       * Set on a Publish run whose publication shipped but whose after publishing line failed:
       * its own outcome, as the work did ship, which skips the on-failure loop and is escalated
       * (spec §2.3 Loops).
       */
      readonly afterPublishingFailed?: PublishedWork;
      /**
       * A Publish Stage's result, Conflict, After publishing failed or Failed; undefined for any
       * other run, and on a Publish run stored before results were kept, whose `baseMoved` and
       * `afterPublishingFailed` say it. Read it through `publishResultOf`.
       */
      readonly publishResult?: PublishResult;
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
  /**
   * The used-up window by the engine module's name for it, such as `five_hour`; undefined for runs
   * held before it was kept.
   */
  readonly window?: string;
  /** When the window resets, as an ISO time: the run is kept as JSON. */
  readonly resetsAt: string;
  /**
   * Set when a Stand-in Engine had room but the session's context was over the size Settings ›
   * Engines asks first above (spec 5.4): the run waits for the user's choice of going on there or
   * waiting for the reset.
   */
  readonly standInChoice?: StandInChoice;
}

/** The Stand-in Engine a held run could go on on, and why The Office asks first. */
export interface StandInChoice {
  /** The Stand-in Engine with room, by its id and its name at the time. */
  readonly engineId: string;
  readonly engineName: string;
  /** The session's context when its turn was refused, in tokens. */
  readonly contextTokens: number;
  /** The size above which Settings › Engines asks before a switch, in tokens. */
  readonly askAbove: number;
}

/**
 * A run's session moved to a Stand-in Engine as its engine refused a turn for a used-up usage
 * window (spec 5.4): from which engine to which, each by its id and its name at the time, the
 * window's words, its reset as an ISO time, and when it moved.
 */
export interface EngineSwitch {
  readonly fromEngineId: string;
  readonly fromEngineName: string;
  readonly toEngineId: string;
  readonly toEngineName: string;
  /** The used-up window as the user reads it, such as "5-hour window". */
  readonly windowWords: string;
  readonly resetsAt: string;
  readonly at: string;
  /**
   * The user who chose the switch for a run held waiting for their choice (spec 5.4), recorded on
   * that held run; undefined for a switch The Office made by itself while the run ran.
   */
  readonly chosenBy?: HoldingUser;
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

/**
 * A publication that shipped by the publishing mode (spec §2.3 Defaults, "Publish's before and
 * after lines"): a pull request opened, or the branch merged. Kept on the Publish run before its
 * after line runs, so a retry runs only that line and never publishes again.
 */
export interface PublishedWork {
  readonly kind: "pull-request-opened" | "merged";
  /** The Task's branch that shipped. */
  readonly branch: string;
  /** The commit that shipped: after a merge, the merged commit. */
  readonly commit: string;
  readonly pullRequestUrl?: string;
}

/** The base branch moved on since the Task's branch left it, so Publish can't take the branch. */
export interface BaseMoved {
  /** The files a merge would conflict in; none when only a fast-forward can't take it. */
  readonly conflictedFiles: readonly string[];
  /** The base branch it conflicts with; undefined on a run kept before it was. */
  readonly baseBranch?: string;
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

/** A session's context after a turn, against its model's window. */
export interface StageRunContext {
  readonly tokens: number;
  readonly window: number;
}

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
 * The user who held a run with Pause or Stop, or acted at its Gate, as the run keeps them: their id
 * and their name as it was then.
 */
export interface HoldingUser {
  readonly userId: string;
  readonly name: string;
}

/**
 * The failure a failure route carried on, or a round the user or a Consultant allowed went back
 * with, which the next run of the Stage it leads to carries into its Brief.
 */
export interface CarriedFailure {
  /** The key of the Stage that failed, which the route leaves. */
  readonly stageKey: string;
  readonly error: string;
  /** Which time the walk follows the route, from 1, this one included. */
  readonly round: number;
  /**
   * How many times it may: the route's limit with the times answers allowed past it; null for a
   * route with No limit.
   */
  readonly rounds: number | null;
  /** What the user said to do differently this round, when they gave it in a Decision. */
  readonly guidance?: string;
  /** The Consultant whose words the guidance is, by the key of their Role; undefined for the user. */
  readonly guidedBy?: string;
}

/**
 * Why the user dropped the Task at a Gate, as Work keeps a drop reason: Duplicate names the Task it
 * duplicates, Other gives their words.
 */
export type GateDropReason =
  | { readonly kind: "wont-fix" }
  | { readonly kind: "duplicate"; readonly taskId: string }
  | { readonly kind: "cant-reproduce" }
  | { readonly kind: "other"; readonly text: string };

/**
 * The person who acted at a Gate by their Office tool, for the user who asked them: the Role they
 * fill and, for a call held for approval, the user who allowed it.
 */
export interface GatePerson {
  readonly roleKey: string;
  readonly askedBy: HoldingUser;
  readonly allowedBy?: HoldingUser;
}

/**
 * What the user did at a Gate (spec §2.3): let the work continue, with notes every later Agent Stage
 * is briefed with or none, send it back with feedback to an earlier Agent Stage, or drop the Task,
 * with the reason they gave, if any. `byUser` is the user it was for, undefined for an action kept
 * before users existed; `person` is who acted for them, when a person did.
 */
export type GateAction = (
  | { readonly kind: "continue"; readonly feedback?: string }
  | { readonly kind: "send-back"; readonly stageKey: string; readonly feedback: string }
  | { readonly kind: "drop"; readonly reason?: GateDropReason }
) & { readonly byUser?: HoldingUser; readonly person?: GatePerson };

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
 * The user's Restart from… on a Task they paused or stopped (spec §2.4.5), kept on its held run:
 * the walk goes on from the Stage of `stageKey`, any of the Pipeline's, using no route's times.
 */
export interface TaskRestart {
  readonly stageKey: string;
  /** What the user said with it, for the Stage's Brief; undefined for none. */
  readonly feedback: string | undefined;
  readonly byUser: HoldingUser;
}

/**
 * The Restart from… that ran a run, kept on that run: an Agent Stage's run is briefed with its
 * feedback, a Script Stage's only keeps it.
 */
export interface Restarted {
  readonly feedback: string | undefined;
  readonly byUser: HoldingUser;
}

/**
 * The user's Start over (spec §2.4.5), kept on the last run before it: every run up to it is of an
 * earlier start, history only. `resetTo` and `keptRef` are set when the branch was reset.
 */
export interface StartedOver {
  /** Which Start over of the Task this is, from 1. */
  readonly number: number;
  readonly byUser: HoldingUser;
  /** When, as an ISO time: it is kept as JSON. */
  readonly at: string;
  readonly resetTo: string | undefined;
  readonly keptRef: string | undefined;
}

/**
 * Why the walk asks the user (spec §2.3): an Agent's own question, a Stage that failed with no
 * retries left, the Task's tokens reaching a Stage's budget, a Pipeline that ended with the
 * Definition of Done not reported met, a Stage The Office restarted during (spec §2.4), a Publish
 * that found the Task's branch no longer applies cleanly on the base branch, a branch moved
 * outside The Office, a Publish that shipped but whose after publishing line failed, no route
 * out of an ended Stage holding, or the route the walk would follow being at its limit.
 */
export type StageDecisionKind =
  | "agent"
  | "no-retries-left"
  | "route-limit"
  | "budget"
  | "definition-of-done"
  | "restart"
  | "base-moved"
  | "branch-moved"
  | "after-publishing-failed"
  | "no-route-holds";

/** What the user's answer to a Decision lets the walk do. */
export type WalkAnswer =
  /** The Agent's question is answered, in these words: its Stage runs again with them. */
  | { readonly kind: "answered"; readonly answer: string }
  /**
   * Kept from before routes had limits: the failed Stage's first failure route may be followed this
   * many more times.
   */
  | { readonly kind: "more-rounds"; readonly rounds: number }
  /**
   * One more round, with what the user said to do differently, if anything, or the Consultant The
   * Office put the Decision to first (`guidedBy`, by the key of their Role). On a route at its limit
   * (spec §2.3, "When a limit runs out"), it follows the route one time past it: `to` names the
   * route by where it leads (null: End), so whoever let it go once more is known.
   */
  | {
      readonly kind: "one-more-round";
      readonly guidance: string | undefined;
      readonly guidedBy?: string;
      readonly to?: string | null;
    }
  /**
   * The failed Script Stage sends the work back to `to`, the last Agent Stage the walk ran, with its
   * failure and the words given, if any, as that Stage's guidance, using a round of the failed Stage
   * as one more round does; `guidedBy` is the Consultant whose words they are.
   */
  | {
      readonly kind: "send-back";
      readonly to: string;
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
  /**
   * The walk follows the route to `to` (null: the Pipeline's End) though none held, or instead of
   * a route at its limit or a failure with none left, with the user's notes for the Stage it goes
   * on to, if any.
   */
  | { readonly kind: "follow-route"; readonly to: string | null; readonly guidance?: string }
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

/**
 * The cascade's engine a run's Stand-in Engine ran for: its id, its name as the Task's Start
 * recorded it, and why the stand-in was chosen.
 */
export interface StageRunStandIn {
  readonly engineId: string;
  readonly engineName: string;
  readonly reason: string;
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

/** A choice row an Agent chose, by where it leads (null: End), with the reason it gave. */
export interface ChosenRoute {
  readonly to: string | null;
  readonly reason: string;
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
  /** The feedback a Gate sent the work back to this Stage with, when it did. */
  readonly sentBack: SentBack | undefined;
  /**
   * The user's Restart from… on this held run, which the walk goes on from; undefined when none.
   * Optional, as runs made before it carry none.
   */
  readonly restart?: TaskRestart | undefined;
  /** The Restart from… that ran this run; undefined for a run no restart ran. */
  readonly restarted?: Restarted | undefined;
  /** The Start over that came after this run, the last before it; undefined otherwise. */
  readonly startedOver?: StartedOver | undefined;
  /** The Stage Thread an Agent Stage's run works in, once it has one. */
  readonly threadId: string | undefined;
  /**
   * The Role that worked an Agent Stage's run, as its Stage named it or held its duty when the run
   * started; undefined for another kind's run, and for runs kept before it was recorded.
   */
  readonly roleKey: string | undefined;
  /** How the run's session began; undefined for a run that opened none. */
  readonly session: StageSessionMove | undefined;
  /**
   * The commit The Office left the Task's branch at after the run: its commit of the Stage's work,
   * or where the branch was when the Stage changed nothing or changed git itself. The next Agent
   * Stage expects HEAD there. Undefined for a run that leaves git as it was.
   */
  readonly headCommit: string | undefined;
  /**
   * The paths of the commit The Office made of the run's work, against its first parent, both
   * paths of a rename; none for a run that ended with nothing committed, a base update not being
   * its own change. Undefined until The Office records where the run left the branch, and for runs
   * kept before this was recorded.
   */
  readonly changedFiles: readonly string[] | undefined;
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
  /**
   * The cascade's engine the run's engine stood in for, as a Stand-in Engine the Task's Start chose
   * (spec §5.4); undefined for a run on the cascade's own engine, one that opened no session, and
   * runs kept before it was recorded.
   */
  readonly standInFor: StageRunStandIn | undefined;
  /**
   * Each time its session moved to a Stand-in Engine during the run, in order; `engineId` is the
   * engine it moved to last. None for a run that stayed on one engine.
   */
  readonly engineSwitches: readonly EngineSwitch[];
  /** Its engine calls' tokens; none for a run that made none. */
  readonly tokens: StageTokens;
  /**
   * Its session's context after the run's last turn, kept with the run, as a later run that resumes
   * the session moves the Thread's on. Undefined for a run that read none: one that opened no
   * session, stopped before the first turn ended, ran on an engine that can't report its context,
   * or was kept before this was.
   */
  readonly context: StageRunContext | undefined;
  /** The Decisions the walk opened on the run, at most one of each kind. */
  readonly decisions: readonly StageRunDecision[];
  /**
   * What the user, or the fire alarm, asked of the run while it ran, the strongest kept, so a start
   * after a crash honours it: a Stop discards the run's edits, a Pause or the alarm keeps them.
   * Undefined while nobody asked.
   */
  readonly heldBy: AskedInterruption | undefined;
  /**
   * The user who asked for `heldBy`'s Pause or Stop; undefined for the fire alarm and the usage
   * window, and for a run held before users existed.
   */
  readonly heldByUser: HoldingUser | undefined;
  /**
   * What the user did at a Gate's run, which ends as the Task reaches the Gate and waits for it.
   * Undefined while the Gate waits, and for every other kind's run.
   */
  readonly gateAction: GateAction | undefined;
  /** Undefined while the Stage runs. */
  readonly outcome: StageOutcome | undefined;
  /**
   * What a Publish run shipped, kept before its after publishing line runs; undefined for every
   * other run, and for a Publish that shipped nothing or runs no such line.
   */
  readonly published: PublishedWork | undefined;
  /**
   * The route an Agent Stage's Agent chose with `choose_route`, the last call counting (spec §2.3,
   * "How an Agent chooses its route"); undefined while it chose none, and for every other run.
   */
  readonly choice: ChosenRoute | undefined;
  /**
   * Since when a Script Stage's run waits for a free run environment, every one Run environments at
   * once allows being in use; undefined while it doesn't, and once its command starts.
   */
  readonly waitingSince: Date | undefined;
  readonly startedAt: Date;
  readonly endedAt: Date | undefined;
}

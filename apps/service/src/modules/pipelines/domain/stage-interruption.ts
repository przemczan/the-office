import type { StageInterruption, StageOutcome } from "./stage-run.js";

interface InterruptionRule {
  /**
   * Whether it stops the Agent's running turn now and discards the Stage's uncommitted edits, or
   * waits for the turn to end and keeps them for the Stage to go on with.
   */
  readonly actsNow: boolean;
  /**
   * Whether it stops a Project command running for the Stage too. The user's Stop doesn't: the
   * command runs to its end (the user's answer of 2026-10-26); The Office shutting down can't wait.
   */
  readonly stopsCommands: boolean;
}

/** The one interrupted-run rule (spec §2.4), by kind. */
const RULES: Readonly<Record<StageInterruption, InterruptionRule>> = {
  pause: { actsNow: false, stopsCommands: false },
  // A Script Stage stops at once; an Agent's turn goes on to its safe point (spec §2.8).
  alarm: { actsNow: false, stopsCommands: true },
  stop: { actsNow: true, stopsCommands: false },
  restart: { actsNow: true, stopsCommands: true },
};

/** Weakest first: each asks more of a run than those before it. */
const RANKS: readonly StageInterruption[] = ["pause", "alarm", "stop", "restart"];

/**
 * What cut a held run's Agent turn short, before it ended by itself: The Office shutting down, or
 * the fire alarm's hard stop.
 */
export type CutShortBy = "restart" | "alarm";

export function actsNow(interruption: StageInterruption): boolean {
  return RULES[interruption].actsNow;
}

export function stopsCommands(interruption: StageInterruption): boolean {
  return RULES[interruption].stopsCommands;
}

/** Whether it holds the run once the Agent's turn ends, its edits kept: a Pause or the fire alarm. */
export function waitsForTheTurn(interruption: StageInterruption | undefined): boolean {
  return interruption !== undefined && !actsNow(interruption);
}

/** Whether `interruption` asks more of a run than `asked` already did, so it replaces it. */
export function outranks(
  interruption: StageInterruption,
  asked: StageInterruption | undefined,
): boolean {
  return asked === undefined || RANKS.indexOf(interruption) > RANKS.indexOf(asked);
}

/** The first words of a run The Office restarted during, which the user reads in its Decision. */
export const RESTARTED = "The Office restarted during this Stage.";

/**
 * The run The Office records for the Stage it would start next, having restarted between Stages
 * (spec §2.4): never started, so nothing to discard, and asked about as a restart is.
 */
export function notStartedOutcome(): StageOutcome {
  return {
    status: "failed",
    error: "The Office restarted before this Stage started.",
    interrupted: "restart",
    notStarted: true,
  };
}

/**
 * How an interrupted run ends: failed, marked so the walk doesn't count a failure (spec §2.4,
 * §5.5). A Stop or a restart names what The Office discarded; a Pause or the fire alarm keeps the
 * worktree as the Agent left it, even once its turn was cut short.
 */
export function interruptedOutcome(
  interruption: StageInterruption,
  discardedPaths: readonly string[],
  { cutShortBy }: { readonly cutShortBy?: CutShortBy } = {},
): StageOutcome {
  if (cutShortBy && waitsForTheTurn(interruption)) {
    return cutShortOutcome(interruption, cutShortBy);
  }
  return {
    status: "failed",
    error: errorOf(interruption, discardedPaths),
    interrupted: interruption,
  };
}

/**
 * How a held run ends when its Agent's turn is cut short before it ends, by The Office shutting
 * down or the alarm's hard stop: the run is held as asked, its edits kept (the user's answer of
 * 2026-10-26), so no Decision opens and the Stage goes on with them.
 */
function cutShortOutcome(interruption: StageInterruption, cutShortBy: CutShortBy): StageOutcome {
  const cut =
    cutShortBy === "restart"
      ? "The Office restarted during the Agent's last turn and cut it short"
      : "Its hard stop cut the Agent's last turn short";
  return {
    status: "failed",
    error: `${heldWords(interruption)} ${cut}: the Stage's uncommitted edits stay in the worktree, maybe half-done, for it to go on with.`,
    interrupted: interruption,
    cutShort: true,
  };
}

function heldWords(interruption: StageInterruption): string {
  return interruption === "alarm" ? "Held by the fire alarm." : "Paused by the user.";
}

function errorOf(interruption: StageInterruption, discardedPaths: readonly string[]): string {
  switch (interruption) {
    case "stop":
      return `Stopped by the user. ${discardedWords(discardedPaths.length)}`;
    case "pause":
      return "Paused by the user. The Stage's uncommitted edits stay in the worktree for it to go on with.";
    case "alarm":
      return "Held by the fire alarm. The Stage's uncommitted edits stay in the worktree for it to go on with after the all clear.";
    case "restart":
      return `${RESTARTED} ${discardedWords(discardedPaths.length)}`;
  }
}

function discardedWords(count: number): string {
  if (count === 0) return "The Stage had left no uncommitted edits.";
  const files = count === 1 ? "1 file" : `${count} files`;
  return `The Office discarded the Stage's uncommitted edits to ${files}.`;
}

/**
 * The line a Stage's work in its Thread closes with: that the user held it with Pause or Stop, or
 * the fire alarm did, which is no failure (spec §2.4, §2.8), or why it failed. A restart is a
 * failure: The Office ended it.
 */
export type StageWorkClosing =
  | { readonly kind: "failure"; readonly reason: string }
  | { readonly kind: "held"; readonly heldBy: "pause" | "stop" | "alarm"; readonly text: string };

/** The closing line of a run's outcome; undefined for a run that neither failed nor was held. */
export function closingOf(outcome: StageOutcome): StageWorkClosing | undefined {
  if (outcome.status !== "failed") return undefined;
  const { interrupted, error } = outcome;
  return interrupted === "pause" || interrupted === "stop" || interrupted === "alarm"
    ? { kind: "held", heldBy: interrupted, text: error }
    : { kind: "failure", reason: error };
}

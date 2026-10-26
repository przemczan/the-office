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
  stop: { actsNow: true, stopsCommands: false },
  restart: { actsNow: true, stopsCommands: true },
};

/** Weakest first: each asks more of a run than those before it. */
const RANKS: readonly StageInterruption[] = ["pause", "stop", "restart"];

export function actsNow(interruption: StageInterruption): boolean {
  return RULES[interruption].actsNow;
}

export function stopsCommands(interruption: StageInterruption): boolean {
  return RULES[interruption].stopsCommands;
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
 * §5.5). A Stop or a restart names what The Office discarded; a Pause keeps the worktree as the
 * Agent left it.
 */
export function interruptedOutcome(
  interruption: StageInterruption,
  discardedPaths: readonly string[],
  { cutShort = false }: { readonly cutShort?: boolean } = {},
): StageOutcome {
  if (cutShort && interruption === "pause") return cutShortPauseOutcome();
  return {
    status: "failed",
    error: errorOf(interruption, discardedPaths),
    interrupted: interruption,
  };
}

/**
 * How a run the user paused ends when The Office shuts down before the Agent's turn does: the
 * turn is cut short, but the run is held as the Pause asked, its edits kept (the user's answer of
 * 2026-10-26), so no Decision opens and Resume goes on with it.
 */
function cutShortPauseOutcome(): StageOutcome {
  return {
    status: "failed",
    error:
      "Paused by the user. The Office restarted during the Agent's last turn and cut it short: the Stage's uncommitted edits stay in the worktree, maybe half-done, for it to go on with.",
    interrupted: "pause",
    cutShort: true,
  };
}

function errorOf(interruption: StageInterruption, discardedPaths: readonly string[]): string {
  switch (interruption) {
    case "stop":
      return `Stopped by the user. ${discardedWords(discardedPaths.length)}`;
    case "pause":
      return "Paused by the user. The Stage's uncommitted edits stay in the worktree for it to go on with.";
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
 * The line a Stage's work in its Thread closes with: that the user held it with Pause or Stop,
 * which is no failure (spec §2.4), or why it failed. A restart is a failure: The Office ended it.
 */
export type StageWorkClosing =
  | { readonly kind: "failure"; readonly reason: string }
  | { readonly kind: "held"; readonly heldBy: "pause" | "stop"; readonly text: string };

/** The closing line of a run's outcome; undefined for a run that neither failed nor was held. */
export function closingOf(outcome: StageOutcome): StageWorkClosing | undefined {
  if (outcome.status !== "failed") return undefined;
  const { interrupted, error } = outcome;
  return interrupted === "pause" || interrupted === "stop"
    ? { kind: "held", heldBy: interrupted, text: error }
    : { kind: "failure", reason: error };
}

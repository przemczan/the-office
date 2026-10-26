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
 * How an interrupted run ends: failed, marked so the walk doesn't count a failure (spec §2.4,
 * §5.5). A Stop or a restart names what The Office discarded; a Pause keeps the worktree as the
 * Agent left it.
 */
export function interruptedOutcome(
  interruption: StageInterruption,
  discardedPaths: readonly string[],
): StageOutcome {
  return {
    status: "failed",
    error: errorOf(interruption, discardedPaths),
    interrupted: interruption,
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

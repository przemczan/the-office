import type { StageInterruption, StageOutcome } from "./stage-run.js";

/**
 * Whether an interruption stops the Agent's running turn now and discards the Stage's uncommitted
 * edits (Stop), or waits for the turn to end and keeps them for the Stage to go on with (Pause).
 */
const ACTS_NOW: Readonly<Record<StageInterruption, boolean>> = {
  stop: true,
  pause: false,
};

export function actsNow(interruption: StageInterruption): boolean {
  return ACTS_NOW[interruption];
}

/**
 * How an interrupted run ends: failed, marked so the walk runs the Stage again rather than
 * counting a failure (spec §2.4, §5.5). A Stop names what The Office discarded; a Pause keeps the
 * worktree as the Agent left it.
 */
export function interruptedOutcome(
  interruption: StageInterruption,
  discardedPaths: readonly string[],
): StageOutcome {
  const error =
    interruption === "stop"
      ? `Stopped by the user. ${discardedWords(discardedPaths.length)}`
      : "Paused by the user. The Stage's uncommitted edits stay in the worktree for it to go on with.";
  return { status: "failed", error, interrupted: interruption };
}

function discardedWords(count: number): string {
  if (count === 0) return "The Stage had left no uncommitted edits.";
  const files = count === 1 ? "1 file" : `${count} files`;
  return `The Office discarded the Stage's uncommitted edits to ${files}.`;
}

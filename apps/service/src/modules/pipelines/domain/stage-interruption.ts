import type { StageInterruption, StageOutcome } from "./stage-run.js";

const STAGE_INTERRUPTIONS: readonly StageInterruption[] = ["stop"];

const WHY: Readonly<Record<StageInterruption, string>> = {
  stop: "Stopped by the user.",
};

/** The interruption an aborted run's signal carries as its reason. */
export function interruptionOf(reason: unknown): StageInterruption {
  const interruption = STAGE_INTERRUPTIONS.find((each) => each === reason);
  if (!interruption) {
    throw new Error(`A Stage run was interrupted for no known reason: ${String(reason)}.`);
  }
  return interruption;
}

/**
 * How an interrupted run ends: failed, with why and what of the Stage's work The Office discarded,
 * marked so the walk runs the Stage again rather than counting a failure (spec §2.4, §5.5).
 */
export function interruptedOutcome(
  interruption: StageInterruption,
  discardedPaths: readonly string[],
): StageOutcome {
  return {
    status: "failed",
    error: `${WHY[interruption]} ${discardedWords(discardedPaths.length)}`,
    interrupted: interruption,
  };
}

function discardedWords(count: number): string {
  if (count === 0) return "The Stage had left no uncommitted edits.";
  const files = count === 1 ? "1 file" : `${count} files`;
  return `The Office discarded the Stage's uncommitted edits to ${files}.`;
}

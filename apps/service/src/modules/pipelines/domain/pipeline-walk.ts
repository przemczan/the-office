import type { Stage } from "./stage.js";
import type { CarriedFailure, StageRun } from "./stage-run.js";

/** What the walk over a Task's Stages does next. */
export type NextMove =
  /** Run the Stage; `carriedFailure` is set when a loop just went back to it. */
  | {
      readonly move: "run";
      readonly stage: Stage;
      readonly carriedFailure: CarriedFailure | undefined;
    }
  /** The last run is still running, or ended needing a Decision the user hasn't answered. */
  | { readonly move: "wait"; readonly run: StageRun }
  /** The last run failed with this error and no retries left. */
  | { readonly move: "stop"; readonly run: StageRun; readonly error: string }
  /** Every Stage ended done. */
  | { readonly move: "complete" };

interface WalkPosition {
  readonly index: number;
  readonly carriedFailure: CarriedFailure | undefined;
}

/**
 * The one walk over a Task's Stages (spec §2.3): a straight list whose only control flow is "on
 * failure go back to Stage X, at most N times". The position and each loop's rounds are replayed
 * from the Task's Stage runs, oldest first, so they are kept nowhere else. A loop's rounds belong
 * to the Stage that owns it and count over the whole Task: going back again never resets them.
 */
export function nextMove(stages: readonly Stage[], runs: readonly StageRun[]): NextMove {
  let position: WalkPosition = { index: 0, carriedFailure: undefined };
  const roundsUsed = new Map<string, number>();
  for (const [index, run] of runs.entries()) {
    const stage = stageOfRun(stages, position.index, run);
    const last = index === runs.length - 1;
    const { outcome } = run;
    if (!outcome || outcome.status === "needs-decision") {
      if (last) return { move: "wait", run };
      // An answered Decision lets the same Stage run again; one still running is a fault.
      if (!outcome) throw new Error(`Stage run ${run.id} is still running, yet runs follow it.`);
      position = { index: position.index, carriedFailure: undefined };
      continue;
    }
    if (outcome.status === "done") {
      position = { index: position.index + 1, carriedFailure: undefined };
      continue;
    }
    const goingBack = goBack(stages, stage, roundsUsed, outcome.error);
    if (!goingBack) {
      if (last) return { move: "stop", run, error: outcome.error };
      throw new Error(`Stage run ${run.id} failed with no retries left, yet runs follow it.`);
    }
    roundsUsed.set(stage.key, goingBack.carriedFailure.round);
    position = goingBack;
  }
  const stage = stages[position.index];
  return stage
    ? { move: "run", stage, carriedFailure: position.carriedFailure }
    : { move: "complete" };
}

/** The Stage the walk stands at, which the run must be of. */
function stageOfRun(stages: readonly Stage[], index: number, run: StageRun): Stage {
  const stage = stages[index];
  if (stage?.key !== run.stageKey) {
    const expected = stage ? `"${stage.key}"` : "none, as they have all ended";
    throw new Error(
      `Stage run ${run.number} of Task ${run.taskId} ran "${run.stageKey}"; its Stages expected ${expected}.`,
    );
  }
  return stage;
}

/** Where the failed Stage's loop goes back to, or undefined when it has no retries left. */
function goBack(
  stages: readonly Stage[],
  failed: Stage,
  roundsUsed: ReadonlyMap<string, number>,
  error: string,
): (WalkPosition & { readonly carriedFailure: CarriedFailure }) | undefined {
  const onFailure = failed.kind === "gate" ? undefined : failed.onFailure;
  if (!onFailure) return undefined;
  const round = (roundsUsed.get(failed.key) ?? 0) + 1;
  if (round > onFailure.rounds) return undefined;
  const index = stages.findIndex(({ key }) => key === onFailure.goBackTo);
  // The library refuses a loop to a Stage that isn't earlier (stageProblems), so this is a fault.
  if (index < 0 || index >= stages.indexOf(failed)) {
    throw new Error(
      `Stage "${failed.key}" goes back to "${onFailure.goBackTo}", which isn't earlier.`,
    );
  }
  return {
    index,
    carriedFailure: { stageKey: failed.key, error, round, rounds: onFailure.rounds },
  };
}

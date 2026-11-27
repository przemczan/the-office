/**
 * What became of a started Task that the user hears of (spec §2.7 Outcomes). Failed is a Stage that
 * failed for good: with no retries left, or the Pipeline ending with the Definition of Done not met
 * (the user's answer of 2026-10-27); either way The Office's Decision about it waits in Needs you.
 */
export type TaskOutcomeKind = "done" | "failed" | "paused";

export interface TaskOutcome {
  readonly taskId: string;
  readonly outcome: TaskOutcomeKind;
  readonly occurredAt: Date;
  /** The Stage a failure is of, when one is named; undefined for any other outcome. */
  readonly stageName?: string;
}

/** Each Task's latest outcome, latest first: a Task shows once in Since you left. */
export function latestPerTask(outcomes: readonly TaskOutcome[]): TaskOutcome[] {
  const latest = new Map<string, TaskOutcome>();
  for (const outcome of outcomes) {
    const known = latest.get(outcome.taskId);
    if (!known || known.occurredAt.getTime() <= outcome.occurredAt.getTime()) {
      latest.set(outcome.taskId, outcome);
    }
  }
  return [...latest.values()].toSorted(
    (one, other) => other.occurredAt.getTime() - one.occurredAt.getTime(),
  );
}

import type { OutOfReachStatement, StageOutcome, StageRun } from "./stage-run.js";

/**
 * The numbers, from 1, of the Definition of Done statements Reported met (spec §2.3): met once any
 * Agent Stage run that ended done reported it, until a later report lists it as no longer met.
 * Script Stages report none. `runs` are the Task's, oldest first.
 */
export function reportedMet(runs: readonly StageRun[]): readonly number[] {
  return reportedMetIn(runs.map(({ outcome }) => outcome));
}

/** `reportedMet` over the outcomes of the Task's runs, oldest first. */
export function reportedMetIn(outcomes: readonly (StageOutcome | undefined)[]): readonly number[] {
  return [...definitionOfDoneReports(outcomes).met].toSorted((one, other) => one - other);
}

/**
 * The statements Out of reach, by their numbers with the latest why, counted across reports as
 * `reportedMet` is: a statement later reported met is no longer Out of reach.
 */
export function reportedOutOfReach(runs: readonly StageRun[]): readonly OutOfReachStatement[] {
  return [...definitionOfDoneReports(runs.map(({ outcome }) => outcome)).outOfReach]
    .map(([statement, why]) => ({ statement, why }))
    .toSorted((one, other) => one.statement - other.statement);
}

/** The Definition of Done statements not Reported met. */
export function unmetStatements(
  definitionOfDone: readonly string[],
  runs: readonly StageRun[],
): string[] {
  const met = new Set(reportedMet(runs));
  return definitionOfDone.filter((_statement, index) => !met.has(index + 1));
}

/** What every Agent Stage's report so far adds up to. */
interface DefinitionOfDoneReports {
  readonly met: ReadonlySet<number>;
  /** The latest why, by the statement's number; never one in `met`. */
  readonly outOfReach: ReadonlyMap<number, string>;
}

/**
 * Folds the done Agent Stage runs' reports, oldest first: each adds what it reports met, takes back
 * what it lists as no longer met, and records its Out of reach statements. Runs stored before
 * reports counted across Stages fold the same way.
 */
function definitionOfDoneReports(
  outcomes: readonly (StageOutcome | undefined)[],
): DefinitionOfDoneReports {
  const met = new Set<number>();
  const outOfReach = new Map<number, string>();
  for (const outcome of outcomes) {
    if (outcome?.status !== "done" || !outcome.definitionOfDoneMet) continue;
    for (const statement of outcome.definitionOfDoneMet) {
      met.add(statement);
      outOfReach.delete(statement);
    }
    for (const statement of outcome.definitionOfDoneNoLongerMet ?? []) met.delete(statement);
    for (const { statement, why } of outcome.definitionOfDoneOutOfReach ?? []) {
      if (!met.has(statement)) outOfReach.set(statement, why);
    }
  }
  return { met, outOfReach };
}

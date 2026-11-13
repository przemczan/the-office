/**
 * What holds a Start without refusing it (spec §2.1, "A queue for Start"): its reason in full, as
 * the Task page, Now and Start show it, and its short reason, as the board card shows it.
 */
export interface Wait {
  readonly reason: string;
  readonly short: string;
}

/** The full reasons of the waits, in their order. */
export function reasonsOf(waits: readonly Wait[]): string[] {
  return waits.map(({ reason }) => reason);
}

/** The short reasons of the waits, in their order. */
export function shortReasonsOf(waits: readonly Wait[]): string[] {
  return waits.map(({ short }) => short);
}

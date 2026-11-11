/** A Task or an Initiative, by when it ended: null while it hasn't, or when nothing dates its end. */
export interface Ended {
  readonly endedAt: string | null;
}

/**
 * The one that ended last first; one whose end nothing dates after every dated one, keeping their
 * order among themselves.
 */
export function lastEndedFirst(one: Ended, other: Ended): number {
  if (one.endedAt === other.endedAt) return 0;
  if (one.endedAt === null) return 1;
  if (other.endedAt === null) return -1;
  return other.endedAt.localeCompare(one.endedAt);
}

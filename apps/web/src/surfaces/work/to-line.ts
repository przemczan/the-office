/** The Thread a person's tab on an Initiative writes to, among their Threads, and what moves it. */
export interface ToLine {
  readonly threadId: string | undefined;
  /** The newest Thread when it was last set: only a newer one takes the line to it. */
  readonly newestThreadId: string | undefined;
}

/** The line on a Thread the user chose, by the To line or by following a link. */
export function toLinePicked(
  threadId: string | undefined,
  newestThreadId: string | undefined,
): ToLine {
  return { threadId, newestThreadId };
}

/**
 * The line as it is now. It goes to a new Thread, and a pick holds until one starts. While the user
 * has a draft nothing moves it, so what they type never changes hands unseen. An unchanged line comes
 * back as it was.
 */
export function toLineNow(
  line: ToLine | undefined,
  newestThreadId: string | undefined,
  drafting: boolean,
): ToLine {
  if (line === undefined) return toLinePicked(newestThreadId, newestThreadId);
  if (drafting || newestThreadId === line.newestThreadId) return line;
  return toLinePicked(newestThreadId, newestThreadId);
}

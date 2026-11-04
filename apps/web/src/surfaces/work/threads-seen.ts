/** The Threads a page has seen: the one shown, and those added since the page opened. */
export interface ThreadsSeen {
  readonly known: readonly string[];
  readonly shownId: string | undefined;
  /** Added while the page was open and not looked at yet, marked new. */
  readonly fresh: ReadonlySet<string>;
  /** The Thread the address last asked for, so only a change of it moves what is shown. */
  readonly asked: string | undefined;
}

/**
 * What the page has seen of the record's Threads as they are now, the newest first. At first it
 * shows `asked` or the newest. A Thread added later, such as a Stage's session starting, is marked
 * new and the user stays where they are (problem 7, docs/tasks/archive/17-settings-acceptance.md).
 * A link on the page changing `asked` shows that Thread. With nothing changed it comes back as it was.
 */
export function threadsSeen(
  seen: ThreadsSeen | undefined,
  threadIds: readonly string[],
  asked?: string,
): ThreadsSeen {
  if (seen === undefined || seen.known.length === 0) {
    if (seen !== undefined && threadIds.length === 0) return seen;
    const shownId = asked && threadIds.includes(asked) ? asked : threadIds[0];
    return { known: threadIds, shownId, fresh: new Set(), asked };
  }
  const placed = withThreadsAdded(seen, threadIds);
  if (asked === placed.asked) return placed;
  const followed = { ...placed, asked };
  return asked && threadIds.includes(asked)
    ? { ...withThreadSeen(followed, asked), shownId: asked }
    : followed;
}

function withThreadsAdded(seen: ThreadsSeen, threadIds: readonly string[]): ThreadsSeen {
  const added = threadIds.filter((id) => !seen.known.includes(id));
  if (added.length === 0) return seen;
  return {
    ...seen,
    known: [...seen.known, ...added],
    fresh: new Set([...seen.fresh, ...added]),
  };
}

/** `threadId` looked at, so no longer new. */
export function withThreadSeen(seen: ThreadsSeen, threadId: string): ThreadsSeen {
  const fresh = new Set(seen.fresh);
  fresh.delete(threadId);
  return { ...seen, fresh };
}

/** The tabs of a record's Threads: their order, the one shown, and those added since the page opened. */
export interface ThreadTabs {
  readonly order: readonly string[];
  readonly shownId: string | undefined;
  /** Added while the page was open and not looked at yet, marked new. */
  readonly fresh: ReadonlySet<string>;
}

/**
 * The tabs for the record's Threads as they are now. The first Threads seen keep their order, the
 * newest first, showing `shownFirst` or the newest. A Thread added later, such as a Stage's
 * session starting, goes right after the shown tab, marked new, and the user stays where they are
 * (problem 7, docs/tasks/archive/17-settings-acceptance.md). Unchanged tabs come back as they were.
 */
export function threadTabs(
  tabs: ThreadTabs | undefined,
  threadIds: readonly string[],
  shownFirst?: string,
): ThreadTabs {
  if (tabs === undefined || tabs.order.length === 0) {
    if (tabs !== undefined && threadIds.length === 0) return tabs;
    const shownId = shownFirst && threadIds.includes(shownFirst) ? shownFirst : threadIds[0];
    return { order: threadIds, shownId, fresh: new Set() };
  }
  const added = threadIds.filter((id) => !tabs.order.includes(id));
  if (added.length === 0) return tabs;
  const shownAt = tabs.shownId === undefined ? -1 : tabs.order.indexOf(tabs.shownId);
  const insertAt = shownAt === -1 ? tabs.order.length : shownAt + 1;
  return {
    order: [...tabs.order.slice(0, insertAt), ...added, ...tabs.order.slice(insertAt)],
    shownId: tabs.shownId,
    fresh: new Set([...tabs.fresh, ...added]),
  };
}

/** The tabs with `threadId` shown, no longer new. */
export function withTabShown(tabs: ThreadTabs, threadId: string): ThreadTabs {
  const fresh = new Set(tabs.fresh);
  fresh.delete(threadId);
  return { ...tabs, shownId: threadId, fresh };
}

/** What the address says about the conversation's drawer. */
export interface DrawerAddress {
  /** The Thread the address names. */
  readonly threadId: string | undefined;
  /** The Decision the address names. */
  readonly decisionId: string | undefined;
  /** It waits in Needs you, so a link to it lands on the card under the drawer. */
  readonly decisionIsOpen: boolean;
}

export type DrawerMove = "open" | "close" | "stay";

/**
 * Only what the address gained moves the drawer, once: an address staying as it was must not undo
 * the reader closing it, and a Decision left in the address must not close it on a pick in To.
 * `before` is undefined on the page's first judgment, once its data has loaded: the drawer starts
 * closed, so a link to an open Decision leaves it as it is, rather than closing it on a reader who
 * opened it while the page loaded.
 */
export function drawerMoveOn(before: DrawerAddress | undefined, now: DrawerAddress): DrawerMove {
  const landsOnCard =
    now.decisionId !== undefined && now.decisionId !== before?.decisionId && now.decisionIsOpen;
  if (landsOnCard) return before === undefined ? "stay" : "close";
  return now.threadId !== undefined && now.threadId !== before?.threadId ? "open" : "stay";
}

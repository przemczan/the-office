/**
 * How the board is laid out, kept in its address beside the filters but apart from them: it narrows
 * nothing, so Clear and the Saved views leave it as it is.
 */
export interface BoardGrouping {
  readonly group?: "initiative";
}

/** The board's grouping from its address, leaving out any other value. */
export function boardGroupingOf(search: Record<string, unknown>): BoardGrouping {
  return search["group"] === "initiative" ? { group: "initiative" } : {};
}

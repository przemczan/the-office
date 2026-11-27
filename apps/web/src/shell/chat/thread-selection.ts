import type { ThreadSummary } from "@the-office/contracts";

/** What the chat's Thread list has picked to delete (spec screens/shell.md, A person's chat). */
export interface ThreadSelection {
  readonly picked: ReadonlySet<string>;
  /** The row pressed last, where a Shift-press's run starts. */
  readonly anchor: string | undefined;
}

export const NOTHING_PICKED: ThreadSelection = { picked: new Set(), anchor: undefined };

/** A Thread that can wait no longer for the user's delete is locked, and can't be picked. */
export function pickable(thread: ThreadSummary): boolean {
  return thread.deletionLock === null;
}

/** What is picked among the Threads shown now: one deleted elsewhere since drops out. */
export function pickedAmong(
  selection: ThreadSelection,
  threads: readonly ThreadSummary[],
): readonly ThreadSummary[] {
  return threads.filter((thread) => selection.picked.has(thread.id) && pickable(thread));
}

/**
 * A press on a row picks it or clears it. With Shift, from the row pressed last to this one every
 * Thread that can be picked takes what this row takes after the press, so the run is picked
 * together or cleared together; a locked row in between stays as it is.
 */
export function pressRow(
  selection: ThreadSelection,
  threads: readonly ThreadSummary[],
  id: string,
  shift: boolean,
): ThreadSelection {
  const pressed = threads.find((thread) => thread.id === id);
  if (!pressed || !pickable(pressed)) return selection;
  const picked = new Set(selection.picked);
  const on = !picked.has(id);
  const ids = threads.map((thread) => thread.id);
  const from = selection.anchor === undefined ? -1 : ids.indexOf(selection.anchor);
  if (shift && from !== -1) {
    const [first, last] = [from, ids.indexOf(id)].toSorted((a, b) => a - b) as [number, number];
    for (const thread of threads.slice(first, last + 1)) {
      if (!pickable(thread)) continue;
      if (on) picked.add(thread.id);
      else picked.delete(thread.id);
    }
  } else if (on) {
    picked.add(id);
  } else {
    picked.delete(id);
  }
  return { picked, anchor: id };
}

/** The bar's box: nothing, every Thread that can be picked, or some of them. */
export function pickedMark(
  selection: ThreadSelection,
  threads: readonly ThreadSummary[],
): false | true | "mixed" {
  const count = pickedAmong(selection, threads).length;
  if (count === 0) return false;
  return count === threads.filter(pickable).length ? true : "mixed";
}

/** The bar's box pressed: every Thread that can be picked, or none when they all are. */
export function pressAll(
  selection: ThreadSelection,
  threads: readonly ThreadSummary[],
): ThreadSelection {
  if (pickedMark(selection, threads) === true) return NOTHING_PICKED;
  return {
    picked: new Set(threads.filter(pickable).map(({ id }) => id)),
    anchor: selection.anchor,
  };
}

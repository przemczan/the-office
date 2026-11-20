import { SavedViewSaved } from "./saved-view-events.js";
import { SavedViewRefused } from "./saved-view-refused.js";
import type { Priority, TaskKind } from "./task.js";

export const SAVED_VIEW_NAME_LENGTH = 60;

/** What narrows the Work board, each left out when not set; never the Project filter. */
export interface BoardFilters {
  readonly query?: string;
  readonly priority?: Priority;
  readonly initiative?: string;
  readonly blocked?: true;
  /** Left out by the views saved before Kinds. */
  readonly kind?: TaskKind;
}

/** A named set of the Work board's filters, shown under "Views" (glossary: Saved view). */
export interface SavedView {
  readonly id: string;
  readonly name: string;
  readonly filters: BoardFilters;
  readonly savedAt: Date;
}

/** What saving a view takes; the rest is set by The Office. */
export type NewSavedView = Pick<SavedView, "name" | "filters">;

/**
 * The filters as a view keeps them: the search's words trimmed, and whatever is left empty left
 * out, so a view holds only the filters that narrow the board.
 */
export function keptBoardFilters(filters: BoardFilters): BoardFilters {
  const query = filters.query?.trim() ?? "";
  return {
    ...(query !== "" && { query }),
    ...(filters.priority !== undefined && { priority: filters.priority }),
    ...(filters.initiative !== undefined && { initiative: filters.initiative }),
    ...(filters.blocked === true && { blocked: true as const }),
    ...(filters.kind !== undefined && { kind: filters.kind }),
  };
}

/** Why a view can't be saved; `namesTaken` are the other views' names. */
export function newSavedViewProblems(view: NewSavedView, namesTaken: readonly string[]): string[] {
  return [
    ...nameProblems(view.name, namesTaken),
    ...(Object.keys(view.filters).length === 0 ? ["Choose a filter for the view to save."] : []),
  ];
}

/** Saves the board's filters under the name; refuses with every reason. */
export function saveView(
  id: string,
  given: NewSavedView,
  namesTaken: readonly string[],
  savedAt: Date,
): { readonly savedView: SavedView; readonly event: SavedViewSaved } {
  const newView = { name: given.name.trim(), filters: keptBoardFilters(given.filters) };
  const problems = newSavedViewProblems(newView, namesTaken);
  if (problems.length > 0) throw new SavedViewRefused(problems);
  const savedView: SavedView = { id, ...newView, savedAt };
  return { savedView, event: new SavedViewSaved(savedView) };
}

function nameProblems(name: string, namesTaken: readonly string[]): string[] {
  if (name === "") return ["Name the view."];
  if (name.length > SAVED_VIEW_NAME_LENGTH) {
    return [`A view's name may be at most ${SAVED_VIEW_NAME_LENGTH} characters.`];
  }
  if (/[\r\n]/.test(name)) return ["A view's name must be one line."];
  const taken = namesTaken.some((each) => each.toLowerCase() === name.toLowerCase());
  return taken ? [`There is already a view named "${name}".`] : [];
}

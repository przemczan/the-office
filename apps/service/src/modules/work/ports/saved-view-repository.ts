import type { SavedView } from "../domain/saved-view.js";

/** Where Saved views are kept. */
export abstract class SavedViewRepository {
  abstract add(savedView: SavedView): Promise<void>;

  /** Every Saved view, in the order saved. */
  abstract list(): Promise<readonly SavedView[]>;

  /** Whether there was such a view to remove. */
  abstract remove(id: string): Promise<boolean>;
}

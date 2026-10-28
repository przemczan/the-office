import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { SavedView } from "./saved-view.js";

export class SavedViewSaved extends DomainEvent {
  constructor(readonly savedView: SavedView) {
    super(savedView.savedAt);
  }
}

export class SavedViewRemoved extends DomainEvent {
  constructor(readonly savedViewId: string) {
    super();
  }
}

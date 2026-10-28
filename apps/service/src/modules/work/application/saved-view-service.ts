import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { saveView, type NewSavedView, type SavedView } from "../domain/saved-view.js";
import { SavedViewRemoved } from "../domain/saved-view-events.js";
import { SavedViewNotFound } from "../domain/saved-view-not-found.js";
import { SavedViewRepository } from "../ports/saved-view-repository.js";

/** Saved views of the Work board's filters, stored by The Office so every browser has them. */
@Injectable()
export class SavedViewService {
  constructor(
    private readonly repository: SavedViewRepository,
    private readonly events: EventBus,
  ) {}

  async list(): Promise<readonly SavedView[]> {
    return this.repository.list();
  }

  /** Refuses with every reason, before saving, when the view breaks a rule. */
  async save(given: NewSavedView): Promise<SavedView> {
    const namesTaken = (await this.repository.list()).map(({ name }) => name);
    const { savedView, event } = saveView(randomUUID(), given, namesTaken, new Date());
    await this.repository.add(savedView);
    await this.events.publish(event);
    return savedView;
  }

  async remove(id: string): Promise<void> {
    if (!(await this.repository.remove(id))) throw new SavedViewNotFound(id);
    await this.events.publish(new SavedViewRemoved(id));
  }
}

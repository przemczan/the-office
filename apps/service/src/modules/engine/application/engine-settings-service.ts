import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { EngineAdded, EngineRemoved } from "../domain/engine-events.js";
import {
  changedEngineSettings,
  type EngineSettings,
  type EngineSettingsEdit,
} from "../domain/engine-settings.js";
import type { Engine } from "../domain/engines.js";
import { EngineSettingsRepository } from "../ports/engine-settings-repository.js";

/**
 * Settings › Engines: the engines, the Office default and the search endpoint, Office-wide.
 * Each session reads them as it starts, so a change applies to the next one.
 */
@Injectable()
export class EngineSettingsService {
  constructor(
    private readonly repository: EngineSettingsRepository,
    private readonly events: EventBus,
  ) {}

  current(): Promise<EngineSettings> {
    return this.repository.read();
  }

  /**
   * Keeps the settings `edit` makes, refusing with every reason when they break a rule, and
   * announces each engine added or removed.
   */
  async change(edit: EngineSettingsEdit): Promise<EngineSettings> {
    const stored = await this.repository.read();
    const changed = changedEngineSettings(stored, edit);
    await this.repository.replace(changed);
    for (const { id, kind } of enginesMissingFrom(changed.engines, stored.engines)) {
      await this.events.publish(new EngineAdded(id, kind));
    }
    for (const { id, kind } of enginesMissingFrom(stored.engines, changed.engines)) {
      await this.events.publish(new EngineRemoved(id, kind));
    }
    return changed;
  }
}

/** The engines of `engines` that `others` doesn't list. */
function enginesMissingFrom(engines: readonly Engine[], others: readonly Engine[]): Engine[] {
  const otherIds = new Set(others.map(({ id }) => id));
  return engines.filter(({ id }) => !otherIds.has(id));
}

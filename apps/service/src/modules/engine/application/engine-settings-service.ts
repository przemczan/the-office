import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { EngineAdded, EngineRemoved } from "../domain/engine-events.js";
import { engineRemovalAmong } from "../domain/engine-removal.js";
import {
  changedEngineSettings,
  settingsWithoutEngine,
  type EngineSettings,
  type EngineSettingsEdit,
} from "../domain/engine-settings.js";
import { EngineSettingsRefused } from "../domain/engine-settings-refused.js";
import type { Engine, EngineId } from "../domain/engines.js";
import { EngineSettingsRepository } from "../ports/engine-settings-repository.js";
import { EngineReferenceMoves } from "./engine-reference-moves.js";
import { EngineSettingsChecks } from "./engine-settings-checks.js";

/**
 * Settings › Engines: the engines, the Office default and the search endpoint, Office-wide.
 * Each session reads them as it starts, so a change applies to the next one.
 */
@Injectable()
export class EngineSettingsService {
  constructor(
    private readonly repository: EngineSettingsRepository,
    private readonly events: EventBus,
    private readonly checks: EngineSettingsChecks,
    private readonly referenceMoves: EngineReferenceMoves,
  ) {}

  current(): Promise<EngineSettings> {
    return this.repository.read();
  }

  /**
   * Keeps the settings `edit` makes, refusing with every reason when they break a rule or a
   * registered check refuses them, and announces each engine added. The checks weigh the settings
   * as read just before, so a change made in between goes unchecked.
   */
  async change(edit: EngineSettingsEdit): Promise<EngineSettings> {
    const stored = await this.repository.read();
    const changed = changedEngineSettings(stored, edit);
    const problems = await this.checks.problemsOf({ before: stored, after: changed });
    if (problems.length > 0) throw new EngineSettingsRefused(problems);
    await this.repository.replace(changed);
    for (const { id, kind } of enginesMissingFrom(changed.engines, stored.engines)) {
      await this.events.publish(new EngineAdded(id, kind));
    }
    return changed;
  }

  /**
   * Removes the engine `engineId`, moving everything naming it to `replacementId` (spec §5.4), and
   * announces it. Refused with every reason, before anything moves, when the removal or the moved
   * levels break a rule or a registered check. The other modules' references move first and the
   * engine goes last: a move failing part way leaves the engine listed and every moved reference on
   * the replacement, also listed, so nothing names an engine that is gone, and removing it again
   * moves the rest.
   */
  async remove(engineId: EngineId, replacementId: EngineId): Promise<EngineSettings> {
    const stored = await this.repository.read();
    const removal = engineRemovalAmong(stored.engines, engineId, replacementId);
    const changed = settingsWithoutEngine(stored, removal);
    const problems = await this.checks.problemsOf({ before: stored, after: changed, removal });
    if (problems.length > 0) throw new EngineSettingsRefused(problems);
    await this.referenceMoves.moveEach(removal);
    await this.repository.replace(changed);
    const removed = stored.engines.find(({ id }) => id === engineId);
    if (removed) await this.events.publish(new EngineRemoved(removed.id, removed.kind));
    return changed;
  }
}

/** The engines of `engines` that `others` doesn't list. */
function enginesMissingFrom(engines: readonly Engine[], others: readonly Engine[]): Engine[] {
  const otherIds = new Set(others.map(({ id }) => id));
  return engines.filter(({ id }) => !otherIds.has(id));
}

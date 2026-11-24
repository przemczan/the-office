import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { ActionRunRefused } from "../domain/action-run-refused.js";
import { ActionSettingsChanged } from "../domain/action-run-events.js";
import { settingsProblems, type ActionSettings } from "../domain/action-settings.js";
import { ActionSettingsStore } from "../ports/action-settings-store.js";

/**
 * Settings › Office limits' Actions card: Actions at once (spec §2.15, Defaults). Lowering it stops
 * none: the next start is refused until fewer are running.
 */
@Injectable()
export class ActionLimits {
  constructor(
    private readonly store: ActionSettingsStore,
    private readonly events: EventBus,
  ) {}

  read(): Promise<ActionSettings> {
    return this.store.read();
  }

  /** Saves the settings; refused (ActionRunRefused) with every problem. */
  async change(settings: ActionSettings): Promise<ActionSettings> {
    const problems = settingsProblems(settings);
    if (problems.length > 0) throw new ActionRunRefused(problems);
    await this.store.change(settings);
    await this.events.publish(new ActionSettingsChanged());
    return this.store.read();
  }
}

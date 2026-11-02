import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { OfficeWideLimitChanged, UsageSettingsChanged } from "../domain/office-limit-events.js";
import { EngineModels } from "../../engine/index.js";
import {
  everyEngineCaps,
  namesEveryEngine,
  type EngineCaps,
  type UsageSettings,
} from "../domain/usage-settings.js";
import { WorkSettings } from "../ports/work-settings.js";

/** The Office's limits on work as Work enforces them; Settings › Office limits changes them. */
@Injectable()
export class OfficeLimits {
  constructor(
    private readonly settings: WorkSettings,
    private readonly events: EventBus,
    private readonly engines: EngineModels,
  ) {}

  /** How many Tasks may be started at once across the Office: the desks (spec §2.2). */
  officeWideLimit(): Promise<number> {
    return this.settings.officeWideLimit();
  }

  /**
   * Applies to the next Start. A limit below the Tasks already started stops none of them: nothing
   * new starts until enough end.
   */
  async changeOfficeWideLimit(officeWideLimit: number): Promise<void> {
    await this.settings.changeOfficeWideLimit(officeWideLimit);
    await this.events.publish(new OfficeWideLimitChanged(officeWideLimit));
  }

  /** The measures Usage estimates are given in and every engine's caps (spec §2.2). */
  async usageSettings(): Promise<UsageSettings> {
    const { measures, caps } = await this.settings.usageSettings();
    return { measures, caps: everyEngineCaps(caps, await this.engines.engines()) };
  }

  /** Whether `caps` name every engine listed now, each once, and no other. */
  async namesEveryEngine(caps: readonly Pick<EngineCaps, "engineId">[]): Promise<boolean> {
    return namesEveryEngine(caps, await this.engines.engines());
  }

  /**
   * Keeps the settings, Window caps only where there are windows, and gives them. Applies to the
   * next Start and release, as a cap stops no Task already started.
   */
  async changeUsageSettings({ measures, caps }: UsageSettings): Promise<UsageSettings> {
    const usageSettings = { measures, caps: everyEngineCaps(caps, await this.engines.engines()) };
    await this.settings.changeUsageSettings(usageSettings);
    await this.events.publish(new UsageSettingsChanged(usageSettings));
    return usageSettings;
  }
}

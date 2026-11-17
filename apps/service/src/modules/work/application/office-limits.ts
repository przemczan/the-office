import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import {
  ArchivePeriodChanged,
  OfficeWideLimitChanged,
  UsageSettingsChanged,
} from "../domain/office-limit-events.js";
import { EngineModels } from "../../engine/index.js";
import {
  everyEngineCaps,
  namesEveryEngine,
  windowCapsWhereWindows,
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

  /** How many days a Done or Dropped Task stays on the board before it is archived (spec §2.1). */
  archivePeriod(): Promise<number> {
    return this.settings.archivePeriod();
  }

  /** Archives nothing by itself: the next daily run archives by the new period. */
  async changeArchivePeriod(archivePeriod: number): Promise<void> {
    await this.settings.changeArchivePeriod(archivePeriod);
    await this.events.publish(new ArchivePeriodChanged(archivePeriod));
  }

  /** The measures Usage estimates are given in and every engine's caps (spec §2.2). */
  async usageSettings(): Promise<UsageSettings> {
    const { measures, caps } = await this.settings.usageSettings();
    return { measures, caps: everyEngineCaps(caps, await this.engines.engines()) };
  }

  /**
   * Why `caps` don't fit the engines listed now, worded; undefined when they name every engine,
   * each once and no other, with Window caps exactly where the account has windows.
   */
  async capsProblem(
    caps: readonly Pick<EngineCaps, "engineId" | "windows">[],
  ): Promise<string | undefined> {
    const engines = await this.engines.engines();
    if (!namesEveryEngine(caps, engines)) return "Every engine has its caps, once.";
    if (!windowCapsWhereWindows(caps, engines)) {
      return "Window caps are on each engine whose account has usage windows, and on no other.";
    }
    return undefined;
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

import { Injectable } from "@nestjs/common";
import type { EngineRemoval } from "../domain/engine-removal.js";
import { officeDefaultEngineModel, type EngineSettings } from "../domain/engine-settings.js";
import type { Engine, EngineModel } from "../domain/engines.js";

/**
 * What a save of Settings › Engines changes for the engine cascade, as the checks read it: the
 * engines, and the Office default as the engine and model it gives (`officeDefaultEngineModel`).
 */
export interface EngineCascadeSettings {
  readonly engines: readonly Engine[];
  readonly officeDefault: EngineModel | null;
}

/** The engine cascade's view of `settings`, which the checks weigh. */
export function engineCascadeSettingsOf(settings: EngineSettings): EngineCascadeSettings {
  return { engines: settings.engines, officeDefault: officeDefaultEngineModel(settings) };
}

/**
 * A save of Settings › Engines: what it holds before and what the save would leave. A removal also
 * moves every other level naming the engine (`movedEngineModel`), which a check weighs too.
 */
export interface EngineSettingsSave {
  readonly before: EngineCascadeSettings;
  readonly after: EngineCascadeSettings;
  readonly removal?: EngineRemoval;
}

/** What makes a save refused, in the UI's words; none lets it through. */
export type EngineSettingsCheck = (save: EngineSettingsSave) => Promise<readonly string[]>;

/**
 * The checks a save of Settings › Engines passes, filled by People as it starts: People reads the
 * engines from Engine, so Engine can't ask People directly (the module template's registry). With
 * none registered, every save passes.
 */
@Injectable()
export class EngineSettingsChecks {
  private readonly checks: EngineSettingsCheck[] = [];

  register(check: EngineSettingsCheck): void {
    this.checks.push(check);
  }

  async problemsOf(save: EngineSettingsSave): Promise<readonly string[]> {
    const problems = await Promise.all(this.checks.map((check) => check(save)));
    return problems.flat();
  }
}

import { Injectable } from "@nestjs/common";
import type { EngineSettings } from "../domain/engine-settings.js";

/** What a save of Settings › Engines changes for the engine cascade: the engines and the Office default. */
export type EngineCascadeSettings = Pick<EngineSettings, "engines" | "officeDefault">;

/** A save of Settings › Engines: what it holds before and what the save would leave. */
export interface EngineSettingsSave {
  readonly before: EngineCascadeSettings;
  readonly after: EngineCascadeSettings;
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

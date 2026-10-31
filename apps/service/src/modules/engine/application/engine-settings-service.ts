import { Injectable } from "@nestjs/common";
import {
  changedEngineSettings,
  type EngineSettings,
  type EngineSettingsEdit,
} from "../domain/engine-settings.js";
import { EngineSettingsRepository } from "../ports/engine-settings-repository.js";

/**
 * Settings › Engines: the API endpoints and the search endpoint, Office-wide. Each session reads
 * them as it starts, so a change applies to the next one.
 */
@Injectable()
export class EngineSettingsService {
  constructor(private readonly repository: EngineSettingsRepository) {}

  current(): Promise<EngineSettings> {
    return this.repository.read();
  }

  /** Keeps the settings `edit` makes, refusing with every reason when they break a rule. */
  async change(edit: EngineSettingsEdit): Promise<EngineSettings> {
    const changed = changedEngineSettings(await this.repository.read(), edit);
    await this.repository.replace(changed);
    return changed;
  }
}

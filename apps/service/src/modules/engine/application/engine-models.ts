import { Injectable } from "@nestjs/common";
import { offeredModels, type Engine, type EngineId } from "../domain/engines.js";
import { EngineSettingsRepository } from "../ports/engine-settings-repository.js";

/** The engines listed now, and the models each offers, by their ids there. */
@Injectable()
export class EngineModels {
  constructor(private readonly settings: EngineSettingsRepository) {}

  async engines(): Promise<readonly Engine[]> {
    return (await this.settings.read()).engines;
  }

  /** The models the engine listed as `engineId` offers; none when Settings › Engines lists none. */
  async offeredOn(engineId: EngineId): Promise<readonly string[]> {
    const engine = (await this.engines()).find(({ id }) => id === engineId);
    return engine === undefined ? [] : offeredModels(engine);
  }
}

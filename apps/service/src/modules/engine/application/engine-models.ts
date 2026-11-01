import { Injectable } from "@nestjs/common";
import { ENGINES, offeredModels, type Engine } from "../domain/engines.js";
import { EngineSettingsRepository } from "../ports/engine-settings-repository.js";

/**
 * The models each engine offers now, as a Role's Model field names them: a fixed list on the
 * Claude Code engines, the API endpoints' models on the OpenAI-compatible API.
 */
@Injectable()
export class EngineModels {
  constructor(private readonly settings: EngineSettingsRepository) {}

  async offeredBy(engine: Engine): Promise<readonly string[]> {
    return offeredModels(engine, (await this.settings.read()).apiEndpoints);
  }

  async byEngine(): Promise<ReadonlyMap<Engine, readonly string[]>> {
    const settings = await this.settings.read();
    return new Map(ENGINES.map((engine) => [engine, offeredModels(engine, settings.apiEndpoints)]));
  }
}

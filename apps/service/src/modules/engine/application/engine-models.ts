import { Injectable } from "@nestjs/common";
import { apiEndpointModels } from "../domain/api-endpoints.js";
import { apiEngines } from "../domain/engine-settings.js";
import {
  CLAUDE_CODE_MODELS,
  ROLE_ENGINES,
  type Engine,
  type RoleEngine,
} from "../domain/engines.js";
import { EngineSettingsRepository } from "../ports/engine-settings-repository.js";

/**
 * The engines listed now, and the models each engine a Role card may name offers, as its Model
 * field names them: the Claude Code models, or every API engine's as `<endpoint>/<model>`.
 */
@Injectable()
export class EngineModels {
  constructor(private readonly settings: EngineSettingsRepository) {}

  async engines(): Promise<readonly Engine[]> {
    return (await this.settings.read()).engines;
  }

  async offeredBy(roleEngine: RoleEngine): Promise<readonly string[]> {
    return modelsOn(roleEngine, await this.engines());
  }

  async byEngine(): Promise<ReadonlyMap<RoleEngine, readonly string[]>> {
    const engines = await this.engines();
    return new Map(ROLE_ENGINES.map((roleEngine) => [roleEngine, modelsOn(roleEngine, engines)]));
  }
}

function modelsOn(roleEngine: RoleEngine, engines: readonly Engine[]): readonly string[] {
  return roleEngine === "openai-compatible-api"
    ? apiEndpointModels(apiEngines(engines))
    : CLAUDE_CODE_MODELS;
}

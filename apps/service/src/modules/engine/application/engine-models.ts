import { Injectable } from "@nestjs/common";
import { offeredModels, type Engine, type EngineId, type EngineModel } from "../domain/engines.js";
import { EngineSettingsRepository } from "../ports/engine-settings-repository.js";

/** The engines listed now, the models each offers, by their ids there, and the Office default. */
@Injectable()
export class EngineModels {
  constructor(private readonly settings: EngineSettingsRepository) {}

  async engines(): Promise<readonly Engine[]> {
    return (await this.settings.read()).engines;
  }

  /** The engine listed as `engineId`; undefined when Settings › Engines lists none. */
  async find(engineId: EngineId): Promise<Engine | undefined> {
    return (await this.engines()).find(({ id }) => id === engineId);
  }

  /** The models the engine listed as `engineId` offers; none when Settings › Engines lists none. */
  async offeredOn(engineId: EngineId): Promise<readonly string[]> {
    const engine = await this.find(engineId);
    return engine === undefined ? [] : offeredModels(engine);
  }

  /** A lookup of the models each engine listed now offers, giving none for an engine not listed. */
  async modelsOffered(): Promise<(engineId: EngineId) => readonly string[]> {
    const offered = new Map(
      (await this.engines()).map((engine) => [engine.id, offeredModels(engine)]),
    );
    return (engineId) => offered.get(engineId) ?? [];
  }

  /**
   * The engine and model of the engine cascade's least specific level (spec §5.4); none only while
   * no engine is listed.
   */
  async officeDefault(): Promise<EngineModel | null> {
    return (await this.settings.read()).officeDefault;
  }
}

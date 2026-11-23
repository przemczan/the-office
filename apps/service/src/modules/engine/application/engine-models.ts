import { Injectable } from "@nestjs/common";
import { officeDefaultEngineModel, type EngineSettings } from "../domain/engine-settings.js";
import {
  offeredModels,
  type Engine,
  type EngineId,
  type EngineModel,
  type OfficeDefault,
} from "../domain/engines.js";
import { EngineSettingsRepository } from "../ports/engine-settings-repository.js";

/**
 * The engines listed now, each Claude Code engine telling whether an API key signs it in, the
 * models each offers, by their ids there, the Office default and the Stand-in Engines.
 */
@Injectable()
export class EngineModels {
  /**
   * The Claude Code engines an API key signs in, which have no usage windows. The key is in the
   * engine's folder, not in the settings, so `EngineAccounts` records what each folder holds as the
   * service starts and on each account change.
   */
  private readonly signedInByApiKey = new Set<EngineId>();

  constructor(private readonly settings: EngineSettingsRepository) {}

  async engines(): Promise<readonly Engine[]> {
    return this.listed((await this.settings.read()).engines);
  }

  /**
   * The engines listed now with the Stand-in Engines and the context size above which a switch of
   * a running Stage asks first, from one read, for `engineToRunOn`.
   */
  async standIns(): Promise<StandInEngineSettings> {
    const { engines, standInEngines, askBeforeSwitchAbove } = await this.settings.read();
    return { engines: this.listed(engines), standInEngines, askBeforeSwitchAbove };
  }

  private listed(engines: readonly Engine[]): readonly Engine[] {
    return engines.map((engine) =>
      engine.kind === "claude-code" && this.signedInByApiKey.has(engine.id)
        ? { ...engine, signedInByApiKey: true }
        : engine,
    );
  }

  /** Records whether an API key signs the Claude Code engine listed as `engineId` in. */
  recordApiKeySignIn(engineId: EngineId, signedInByApiKey: boolean): void {
    if (signedInByApiKey) this.signedInByApiKey.add(engineId);
    else this.signedInByApiKey.delete(engineId);
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
   * The engine and model of the engine cascade's least specific level (spec §5.4): the Office
   * default's engine on its default model; none only while no engine is listed.
   */
  async officeDefault(): Promise<EngineModel | null> {
    return officeDefaultEngineModel(await this.settings.read());
  }

  /** The Office default as Settings › Engines sets it: an engine type and one of its engines. */
  async officeDefaultEngine(): Promise<OfficeDefault | null> {
    return (await this.settings.read()).officeDefault;
  }
}

export type StandInEngineSettings = Pick<
  EngineSettings,
  "engines" | "standInEngines" | "askBeforeSwitchAbove"
>;

import { Injectable } from "@nestjs/common";
import { officeDefaultEngineModel, type EngineSettings } from "../domain/engine-settings.js";
import type { Engine, EngineId, EngineModel } from "../domain/engines.js";
import { EngineSettingsRepository } from "../ports/engine-settings-repository.js";

/**
 * The engines listed now, each Claude Code engine telling whether an API key signs it in, the
 * Office default and the Stand-in Engines.
 */
@Injectable()
export class EngineModels {
  /**
   * The Claude Code engines an API key signs in, which have no usage windows. The key is in the
   * engine's folder, not in the settings, so `EngineAccounts` records what each folder holds as the
   * service starts and on each account change.
   */
  private readonly signedInByApiKey = new Set<EngineId>();
  /**
   * The models each engine's account last listed, by engine id. Kept in the database apart from
   * the settings, so `EngineModelLists` records each as the service starts and as it is listed.
   */
  private readonly modelLists = new Map<EngineId, readonly string[]>();
  /** When each list of `modelLists` was listed, when it was told. */
  private readonly modelListedAt = new Map<EngineId, Date>();

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

  /**
   * `engines`, each Claude Code engine telling whether an API key signs it in, and each engine
   * that lists its models carrying the list its account last gave.
   */
  listed(engines: readonly Engine[]): readonly Engine[] {
    return engines.map((engine) => this.withModelList(this.withApiKeySignIn(engine)));
  }

  /** Records whether an API key signs the Claude Code engine listed as `engineId` in. */
  recordApiKeySignIn(engineId: EngineId, signedInByApiKey: boolean): void {
    if (signedInByApiKey) this.signedInByApiKey.add(engineId);
    else this.signedInByApiKey.delete(engineId);
  }

  /**
   * Records the models the account of the engine listed as `engineId` last gave, which its
   * `offeredModels` are from then on, listed at `listedAt`; undefined forgets them, so its type's
   * fixed list stands.
   */
  recordModelList(
    engineId: EngineId,
    models: readonly string[] | undefined,
    listedAt?: Date,
  ): void {
    if (models === undefined) this.modelLists.delete(engineId);
    else this.modelLists.set(engineId, models);
    if (models === undefined || listedAt === undefined) this.modelListedAt.delete(engineId);
    else this.modelListedAt.set(engineId, listedAt);
  }

  /** When the account of the engine listed as `engineId` last listed its models; undefined if never. */
  modelsListedAt(engineId: EngineId): Date | undefined {
    return this.modelListedAt.get(engineId);
  }

  private withApiKeySignIn(engine: Engine): Engine {
    return engine.kind === "claude-code" && this.signedInByApiKey.has(engine.id)
      ? { ...engine, signedInByApiKey: true }
      : engine;
  }

  private withModelList(engine: Engine): Engine {
    const listedModels = this.modelLists.get(engine.id);
    if (listedModels === undefined) return engine;
    switch (engine.kind) {
      case "claude-code":
      case "codex":
      case "copilot-cli":
        return { ...engine, listedModels };
      case "gemini-cli":
      case "openai-compatible-api":
        return engine;
    }
  }

  /** The engine listed as `engineId`; undefined when Settings › Engines lists none. */
  async find(engineId: EngineId): Promise<Engine | undefined> {
    return (await this.engines()).find(({ id }) => id === engineId);
  }

  /**
   * The engine and model of the engine cascade's least specific level (spec §5.4): the Office
   * default's engine on its default model; none only while no engine is listed.
   */
  async officeDefault(): Promise<EngineModel | null> {
    return officeDefaultEngineModel(await this.settings.read());
  }
}

export type StandInEngineSettings = Pick<
  EngineSettings,
  "engines" | "standInEngines" | "askBeforeSwitchAbove"
>;

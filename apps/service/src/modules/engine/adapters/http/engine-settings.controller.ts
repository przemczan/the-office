import { Body, Controller, Delete, Get, Param, Put, Query, UseFilters } from "@nestjs/common";
import {
  engineRemovalSchema,
  engineSettingsEditSchema,
  type EngineRemoval as EngineRemovalRequest,
  type Engine as EngineResponse,
  type EngineRemovalPreview as EngineRemovalPreviewResponse,
  type EngineSettings as EngineSettingsResponse,
  type EngineSettingsEdit as EngineSettingsEditRequest,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { EngineSettingsService } from "../../application/engine-settings-service.js";
import { offeredModelPrices, type EngineSettings } from "../../domain/engine-settings.js";
import type { Engine } from "../../domain/engines.js";
import { EngineSettingsRefusalFilter } from "./engine-settings-refusal.filter.js";

/**
 * Settings › Engines: the engines, an API engine's key and a Codex engine's API key never sent
 * back, the Office default, the search endpoint, and every offered model's Model price; removing
 * an engine with its replacement, and what that would move.
 */
@Controller("settings/engines")
@UseFilters(EngineSettingsRefusalFilter)
export class EngineSettingsController {
  constructor(private readonly settings: EngineSettingsService) {}

  @Get()
  async read(): Promise<EngineSettingsResponse> {
    return response(await this.settings.current());
  }

  @Put()
  async change(
    @Body(new ContractPipe(engineSettingsEditSchema)) edit: EngineSettingsEditRequest,
  ): Promise<EngineSettingsResponse> {
    return response(await this.settings.change(edit));
  }

  /** What removing the engine with this replacement would move, and why it would be refused. */
  @Get(":engineId/removal")
  async removalPreview(
    @Param("engineId") engineId: string,
    @Query(new ContractPipe(engineRemovalSchema)) { replacement }: EngineRemovalRequest,
  ): Promise<EngineRemovalPreviewResponse> {
    const { moves, problems } = await this.settings.removalPreview(engineId, replacement ?? null);
    return {
      moves: moves.map(({ roleKey, project, from, to }) => ({
        roleKey,
        project: project && { ...project },
        from: { ...from },
        to: to && { ...to },
      })),
      problems: [...problems],
    };
  }

  /** Moves everything naming the engine to the replacement, or to none for the only engine, then removes it. */
  @Delete(":engineId")
  async remove(
    @Param("engineId") engineId: string,
    @Query(new ContractPipe(engineRemovalSchema)) { replacement }: EngineRemovalRequest,
  ): Promise<EngineSettingsResponse> {
    return response(await this.settings.remove(engineId, replacement ?? null));
  }
}

function response(settings: EngineSettings): EngineSettingsResponse {
  const { engines, officeDefault, searchEndpoint, standInEngines, askBeforeSwitchAbove } = settings;
  return {
    engines: engines.map(engineResponse),
    officeDefault: officeDefault && { ...officeDefault },
    searchEndpoint,
    modelPrices: offeredModelPrices(settings).map(({ engineId, model, price }) => ({
      engineId,
      model,
      price: price && { ...price },
    })),
    standInEngines: [...standInEngines],
    askBeforeSwitchAbove,
  };
}

/** Each field named, never the engine spread, so no key it keeps is ever sent back. */
function engineResponse(engine: Engine): EngineResponse {
  const { id, name, defaultModel } = engine;
  switch (engine.kind) {
    case "claude-code":
      return { id, name, kind: engine.kind, defaultModel, claudeCodeP: engine.claudeCodeP };
    case "codex":
    case "copilot-cli":
    case "gemini-cli":
      return { id, name, kind: engine.kind, defaultModel };
    case "openai-compatible-api":
      return {
        id,
        name,
        kind: engine.kind,
        defaultModel,
        baseUrl: engine.baseUrl,
        keySet: engine.key !== "",
        models: engine.models.map(({ id: modelId, contextWindow, seesImages }) => ({
          id: modelId,
          contextWindow,
          seesImages: seesImages ?? false,
        })),
      };
  }
}

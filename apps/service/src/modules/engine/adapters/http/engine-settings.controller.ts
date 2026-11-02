import { Body, Controller, Delete, Get, Param, Put, Query, UseFilters } from "@nestjs/common";
import {
  engineRemovalSchema,
  engineSettingsEditSchema,
  type EngineRemoval as EngineRemovalRequest,
  type Engine as EngineResponse,
  type EngineSettings as EngineSettingsResponse,
  type EngineSettingsEdit as EngineSettingsEditRequest,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { EngineSettingsService } from "../../application/engine-settings-service.js";
import { offeredModelPrices, type EngineSettings } from "../../domain/engine-settings.js";
import type { Engine } from "../../domain/engines.js";
import { EngineSettingsRefusalFilter } from "./engine-settings-refusal.filter.js";

/**
 * Settings › Engines: the engines, an API engine's key never sent back, the Office default, the
 * search endpoint, and every offered model's Model price; removing an engine with its replacement.
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
  const { engines, officeDefault, searchEndpoint } = settings;
  return {
    engines: engines.map(engineResponse),
    officeDefault: officeDefault && { ...officeDefault },
    searchEndpoint,
    modelPrices: offeredModelPrices(settings).map(({ engineId, model, price }) => ({
      engineId,
      model,
      price: price && { ...price },
    })),
  };
}

function engineResponse(engine: Engine): EngineResponse {
  if (engine.kind === "claude-code") return { ...engine };
  const { key, models, ...rest } = engine;
  return { ...rest, keySet: key !== "", models: models.map((model) => ({ ...model })) };
}

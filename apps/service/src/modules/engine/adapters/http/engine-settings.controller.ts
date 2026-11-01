import { Body, Controller, Get, Put, UseFilters } from "@nestjs/common";
import {
  engineSettingsEditSchema,
  type EngineSettings as EngineSettingsResponse,
  type EngineSettingsEdit,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { EngineSettingsService } from "../../application/engine-settings-service.js";
import { offeredModelPrices, type EngineSettings } from "../../domain/engine-settings.js";
import { EngineSettingsRefusalFilter } from "./engine-settings-refusal.filter.js";

/**
 * Settings › Engines: the API endpoints, their keys never sent back, the search endpoint, and every
 * offered model's Model price.
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
    @Body(new ContractPipe(engineSettingsEditSchema)) edit: EngineSettingsEdit,
  ): Promise<EngineSettingsResponse> {
    return response(await this.settings.change(edit));
  }
}

function response(settings: EngineSettings): EngineSettingsResponse {
  const { apiEndpoints, searchEndpoint } = settings;
  return {
    apiEndpoints: apiEndpoints.map(({ id, name, baseUrl, key, models }) => ({
      id,
      name,
      baseUrl,
      keySet: key !== "",
      models: models.map((model) => ({ ...model })),
    })),
    searchEndpoint,
    modelPrices: offeredModelPrices(settings).map(({ engineId, model, price }) => ({
      engineId,
      model,
      price: price && { ...price },
    })),
  };
}

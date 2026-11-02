import { Body, Controller, Get, Put, UseFilters } from "@nestjs/common";
import {
  engineSettingsEditSchema,
  type EngineSettings as EngineSettingsResponse,
  type EngineSettingsEdit as EngineSettingsEditRequest,
  type OfferedModel as OfferedModelResponse,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { EngineSettingsService } from "../../application/engine-settings-service.js";
import { apiEndpointModel, parseApiEndpointModel } from "../../domain/api-endpoints.js";
import {
  apiEngines,
  offeredModelPrices,
  type EngineSettings,
  type EngineSettingsEdit,
} from "../../domain/engine-settings.js";
import type { OfferedModel } from "../../domain/model-prices.js";
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
    @Body(new ContractPipe(engineSettingsEditSchema)) edit: EngineSettingsEditRequest,
  ): Promise<EngineSettingsResponse> {
    return response(await this.settings.change(editOf(edit)));
  }
}

/*
 * The API keeps its shape until step 1c of task 47: the API engines as API endpoints, and the
 * prices keyed as a Role card names its engine and model (`claude-code`, or
 * `openai-compatible-api` with `<endpoint>/<model>`).
 */
const CLAUDE_CODE_PRICES = "claude-code";
const API_PRICES = "openai-compatible-api";

function editOf({
  apiEndpoints,
  searchEndpoint,
  modelPrices,
}: EngineSettingsEditRequest): EngineSettingsEdit {
  return { apiEndpoints, searchEndpoint, modelPrices: modelPrices.map(offeredModelOf) };
}

function offeredModelOf({ engineId, model, price }: OfferedModelResponse): OfferedModel {
  const named = engineId === API_PRICES ? parseApiEndpointModel(model) : undefined;
  if (named !== undefined) return { engineId: named.endpointId, model: named.modelId, price };
  return { engineId: engineId === CLAUDE_CODE_PRICES ? null : engineId, model, price };
}

function offeredModelResponse({ engineId, model, price }: OfferedModel): OfferedModelResponse {
  return engineId === null
    ? { engineId: CLAUDE_CODE_PRICES, model, price: price && { ...price } }
    : {
        engineId: API_PRICES,
        model: apiEndpointModel(engineId, model),
        price: price && { ...price },
      };
}

function response(settings: EngineSettings): EngineSettingsResponse {
  const { engines, searchEndpoint } = settings;
  return {
    apiEndpoints: apiEngines(engines).map(({ id, name, baseUrl, key, models }) => ({
      id,
      name,
      baseUrl,
      keySet: key !== "",
      models: models.map((model) => ({ ...model })),
    })),
    searchEndpoint,
    modelPrices: offeredModelPrices(settings).map(offeredModelResponse),
  };
}

import { Body, Controller, Delete, Get, Param, Put, Query, UseFilters } from "@nestjs/common";
import {
  engineRemovalSchema,
  engineSettingsEditSchema,
  type EngineRemoval as EngineRemovalRequest,
  type Engine as EngineResponse,
  type EngineRemovalPreview as EngineRemovalPreviewResponse,
  type EngineSettings as EngineSettingsResponse,
  type EngineModelList as EngineModelListResponse,
  type EngineSettingsEdit as EngineSettingsEditRequest,
  type EngineWindowStart as EngineWindowStartResponse,
  type WindowStartRecord as WindowStartRecordResponse,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import {
  EngineSettingsService,
  type EngineModelChoices,
  type EngineWindowStart,
  type EngineWindowStarts,
} from "../../application/engine-settings-service.js";
import { offeredModelPrices, type EngineSettings } from "../../domain/engine-settings.js";
import type { Engine } from "../../domain/engines.js";
import type { WindowStartRecord } from "../../domain/window-starts.js";
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
    return this.response(await this.settings.current());
  }

  @Put()
  async change(
    @Body(new ContractPipe(engineSettingsEditSchema)) edit: EngineSettingsEditRequest,
  ): Promise<EngineSettingsResponse> {
    return this.response(await this.settings.change(edit));
  }

  /** What removing the engine with this replacement would move, and why it would be refused. */
  @Get(":engineId/removal")
  async removalPreview(
    @Param("engineId") engineId: string,
    @Query(new ContractPipe(engineRemovalSchema)) { replacement }: EngineRemovalRequest,
  ): Promise<EngineRemovalPreviewResponse> {
    const { moves, problems } = await this.settings.removalPreview(engineId, replacement ?? null);
    return {
      moves: moves.map(({ project, work, standInList, from, to }) => ({
        project: project && { ...project },
        work: work && { ...work },
        ...(standInList ? { standInList } : {}),
        from,
        to,
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
    return this.response(await this.settings.remove(engineId, replacement ?? null));
  }

  private async response(settings: EngineSettings): Promise<EngineSettingsResponse> {
    return settingsResponse(
      settings,
      await this.settings.windowStartsOf(settings),
      this.settings.modelListsOf(settings),
    );
  }
}

function settingsResponse(
  settings: EngineSettings,
  { windowStarts, timeZone }: EngineWindowStarts,
  modelLists: readonly EngineModelChoices[],
): EngineSettingsResponse {
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
    windowStarts: windowStarts.map(windowStartResponse),
    modelLists: modelLists.map(modelListResponse),
    timeZone,
  };
}

function modelListResponse({
  engineId,
  models,
  listsItsModels,
  listedAt,
}: EngineModelChoices): EngineModelListResponse {
  return {
    engineId,
    models: [...models],
    listsItsModels,
    listedAt: listedAt?.toISOString() ?? null,
  };
}

function windowStartResponse({
  engineId,
  startAtTimes,
  startAfterReset,
  nextStartAt,
  last,
}: EngineWindowStart): EngineWindowStartResponse {
  return {
    engineId,
    startAtTimes: [...startAtTimes],
    startAfterReset,
    nextStartAt: nextStartAt?.toISOString() ?? null,
    last: last === undefined ? null : windowStartRecordResponse(last),
  };
}

function windowStartRecordResponse(record: WindowStartRecord): WindowStartRecordResponse {
  const common = { at: record.at.toISOString(), trigger: record.trigger };
  switch (record.outcome) {
    case "started":
      return {
        ...common,
        outcome: record.outcome,
        reason: null,
        error: null,
        fiveHourResetsAt: record.fiveHourResetsAt?.toISOString() ?? null,
      };
    case "skipped":
      return {
        ...common,
        outcome: record.outcome,
        reason: record.reason,
        error: null,
        fiveHourResetsAt: null,
      };
    case "failed":
      return {
        ...common,
        outcome: record.outcome,
        reason: null,
        error: record.error,
        fiveHourResetsAt: null,
      };
  }
}

/** Each field named, never the engine spread, so no key it keeps is ever sent back. */
function engineResponse(engine: Engine): EngineResponse {
  const { id, name, defaultModel, defaultEffort } = engine;
  switch (engine.kind) {
    case "claude-code":
      return {
        id,
        name,
        kind: engine.kind,
        defaultModel,
        defaultEffort,
        claudeCodeP: engine.claudeCodeP,
      };
    case "codex":
    case "copilot-cli":
    case "gemini-cli":
      return { id, name, kind: engine.kind, defaultModel, defaultEffort };
    case "openai-compatible-api":
      return {
        id,
        name,
        kind: engine.kind,
        defaultModel,
        defaultEffort,
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

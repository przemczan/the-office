import type {
  Engine as EngineResponse,
  EngineSettings as EngineSettingsResponse,
  EngineModelList as EngineModelListResponse,
  EngineWindowStart as EngineWindowStartResponse,
  WindowStartRecord as WindowStartRecordResponse,
} from "@the-office/contracts";
import {
  EngineSettingsService,
  type EngineModelChoices,
  type EngineWindowStart,
  type EngineWindowStarts,
} from "../../application/engine-settings-service.js";
import { offeredModelPrices, type EngineSettings } from "../../domain/engine-settings.js";
import type { Engine } from "../../domain/engines.js";
import type { WindowStartRecord } from "../../domain/window-starts.js";

/** The settings as GET and the Office actions of Settings › Engines answer them, no key in them. */
export async function engineSettingsResponseOf(
  service: EngineSettingsService,
  settings: EngineSettings,
): Promise<EngineSettingsResponse> {
  return settingsResponse(
    settings,
    await service.windowStartsOf(settings),
    service.modelListsOf(settings),
  );
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
export function engineResponse(engine: Engine): EngineResponse {
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

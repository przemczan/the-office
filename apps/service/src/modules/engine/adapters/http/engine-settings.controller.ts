import { Controller, Get, Param, Query, UseFilters } from "@nestjs/common";
import {
  engineRemovalSchema,
  type EngineRemoval as EngineRemovalRequest,
  type EngineRemovalPreview as EngineRemovalPreviewResponse,
  type EngineSettings as EngineSettingsResponse,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { EngineSettingsService } from "../../application/engine-settings-service.js";
import type { EngineSettings } from "../../domain/engine-settings.js";
import { EngineSettingsRefusalFilter } from "./engine-settings-refusal.filter.js";
import { engineSettingsResponseOf } from "./engine-settings-responses.js";

/**
 * Settings › Engines, read (its Save, removal and Refresh models are Office actions, `EngineOfficeActionsController`): the engines, an API engine's key and a Codex engine's API key never sent
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

  private async response(settings: EngineSettings): Promise<EngineSettingsResponse> {
    return engineSettingsResponseOf(this.settings, settings);
  }
}

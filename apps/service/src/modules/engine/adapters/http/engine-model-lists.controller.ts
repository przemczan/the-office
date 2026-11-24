import {
  BadGatewayException,
  Controller,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UnprocessableEntityException,
} from "@nestjs/common";
import { EngineModelLists } from "../../application/engine-model-lists.js";
import { EngineRefused } from "../../domain/engine-refused.js";
import { ENGINE_TYPE_NAMES } from "../../domain/engines.js";

/**
 * Settings › Engines' Refresh models (spec §5.4.5, "Models an engine lists"): asks an engine's
 * account for its models now, beside the adapters that ask it, so `EngineSettingsController`
 * stays on the settings alone.
 */
@Controller("settings/engines")
export class EngineModelListsController {
  constructor(private readonly modelLists: EngineModelLists) {}

  /**
   * 204 once the engine answered, the list kept whether it listed models or none; 404 for an
   * engine not listed, 422 for one whose type isn't asked or in a test instance, 502 when asking
   * failed or timed out, in words.
   */
  @Post(":engineId/models/refresh")
  @HttpCode(204)
  async refresh(@Param("engineId") engineId: string): Promise<void> {
    const refreshed = await this.modelLists.refresh(engineId).catch((error: unknown) => {
      if (error instanceof EngineRefused) throw new UnprocessableEntityException(error.message);
      throw error;
    });
    switch (refreshed.outcome) {
      case "listed":
      case "none-listed":
        return;
      case "not-listed":
        throw new NotFoundException("Settings › Engines lists no engine by that id.");
      case "lists-none":
        throw new UnprocessableEntityException(
          `The models of ${refreshed.engine.name} (${ENGINE_TYPE_NAMES[refreshed.engine.kind]}) aren't asked of its account.`,
        );
      case "failed":
        throw new BadGatewayException(
          `${refreshed.engine.name} didn't list its models: ${refreshed.error}`,
        );
    }
  }
}

import { Controller, Get } from "@nestjs/common";
import type { RunEnvironmentOfficeLimits as RunEnvironmentOfficeLimitsResponse } from "@the-office/contracts";
import { RunEnvironmentOfficeLimits } from "../../application/run-environment-office-limits.js";
import { toResponse } from "./run-environment-office-limits-responses.js";

/**
 * Settings › Office limits' Run environments card, read here; its change is an Office action
 * (`SET_RUN_ENVIRONMENT_LIMITS_ACTION`, routed by `RunEnvironmentOfficeActionsController`).
 */
@Controller("settings/run-environments")
export class RunEnvironmentOfficeLimitsController {
  constructor(private readonly officeLimits: RunEnvironmentOfficeLimits) {}

  @Get()
  async read(): Promise<RunEnvironmentOfficeLimitsResponse> {
    return toResponse(await this.officeLimits.read());
  }
}

import { Body, Controller, Get, Put, UseFilters } from "@nestjs/common";
import { actionSettingsSchema, type ActionSettings } from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { ActionLimits } from "../../application/action-limits.js";
import { ActionRunRefusalsFilter } from "./action-run-refusals.filter.js";

/** Settings › Office limits' Actions card: Actions at once; the contract keeps its bounds. */
@Controller("settings/actions")
@UseFilters(ActionRunRefusalsFilter)
export class ActionSettingsController {
  constructor(private readonly limits: ActionLimits) {}

  @Get()
  read(): Promise<ActionSettings> {
    return this.limits.read();
  }

  @Put()
  change(
    @Body(new ContractPipe(actionSettingsSchema)) settings: ActionSettings,
  ): Promise<ActionSettings> {
    return this.limits.change(settings);
  }
}

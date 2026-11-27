import { Controller, UseFilters } from "@nestjs/common";
import { OFFICE_UPDATE_OFFICE_ACTIONS, type OfficeAction } from "@the-office/contracts";
import { officeActionRoutes } from "../../../../platform/http/office-action-routes.js";
import { OfficeUpdateOfficeActions } from "../office-actions/office-update-office-actions.js";
import { ScheduledExitRefusalsFilter } from "./scheduled-exit-refusals.filter.js";

/**
 * The routes of Office updates' Office actions, each derived from its declaration
 * (OFFICE_UPDATE_OFFICE_ACTIONS): the signed-in user's request goes to the one handler the action's
 * Office tool calls too.
 */
@Controller()
@UseFilters(ScheduledExitRefusalsFilter)
export class OfficeUpdateOfficeActionsController extends officeActionRoutes(
  OFFICE_UPDATE_OFFICE_ACTIONS,
) {
  constructor(private readonly actions: OfficeUpdateOfficeActions) {
    super();
  }

  answer(action: OfficeAction): Promise<unknown> {
    return this.actions.answer(action);
  }
}

import { Controller, UseFilters } from "@nestjs/common";
import { PEOPLE_SETTINGS_OFFICE_ACTIONS, type OfficeAction } from "@the-office/contracts";
import { officeActionRoutes } from "../../../../platform/http/office-action-routes.js";
import { DutyOfficeActions } from "../office-actions/duty-office-actions.js";
import { RoleRefusalsFilter } from "./role-refusals.filter.js";

/**
 * The routes of People's Office actions on Office settings, each derived from its declaration
 * (PEOPLE_SETTINGS_OFFICE_ACTIONS): the signed-in user's request goes to the one handler the
 * action's Office tool calls too.
 */
@Controller()
@UseFilters(RoleRefusalsFilter)
export class DutyOfficeActionsController extends officeActionRoutes(
  PEOPLE_SETTINGS_OFFICE_ACTIONS,
) {
  constructor(private readonly actions: DutyOfficeActions) {
    super();
  }

  answer(action: OfficeAction, input: unknown): Promise<unknown> {
    return this.actions.answer(action, input);
  }
}

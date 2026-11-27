import { Controller, UseFilters } from "@nestjs/common";
import { ACTION_SETTINGS_OFFICE_ACTIONS, type OfficeAction } from "@the-office/contracts";
import { officeActionRoutes } from "../../../../platform/http/office-action-routes.js";
import { ActionSettingsOfficeActions } from "../office-actions/action-settings-office-actions.js";
import { ActionRunRefusalsFilter } from "./action-run-refusals.filter.js";

/**
 * The routes of Actions' Office actions on Office settings, each derived from its declaration
 * (ACTION_SETTINGS_OFFICE_ACTIONS): the signed-in user's request goes to the one handler the
 * action's Office tool calls too.
 */
@Controller()
@UseFilters(ActionRunRefusalsFilter)
export class ActionSettingsOfficeActionsController extends officeActionRoutes(
  ACTION_SETTINGS_OFFICE_ACTIONS,
) {
  constructor(private readonly actions: ActionSettingsOfficeActions) {
    super();
  }

  answer(action: OfficeAction, input: unknown): Promise<unknown> {
    return this.actions.answer(action, input);
  }
}

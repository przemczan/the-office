import { Controller } from "@nestjs/common";
import { WORK_SETTINGS_OFFICE_ACTIONS, type OfficeAction } from "@the-office/contracts";
import { officeActionRoutes } from "../../../../platform/http/office-action-routes.js";
import { WorkSettingsOfficeActions } from "../office-actions/work-settings-office-actions.js";

/**
 * The routes of Work's Office actions on Office settings, each derived from its declaration
 * (WORK_SETTINGS_OFFICE_ACTIONS): the signed-in user's request goes to the one handler the action's
 * Office tool calls too.
 */
@Controller()
export class WorkSettingsOfficeActionsController extends officeActionRoutes(
  WORK_SETTINGS_OFFICE_ACTIONS,
) {
  constructor(private readonly actions: WorkSettingsOfficeActions) {
    super();
  }

  answer(action: OfficeAction, input: unknown): Promise<unknown> {
    return this.actions.answer(action, input);
  }
}

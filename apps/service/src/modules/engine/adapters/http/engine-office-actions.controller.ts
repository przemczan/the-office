import { Controller, UseFilters } from "@nestjs/common";
import { ENGINES_OFFICE_ACTIONS, type OfficeAction } from "@the-office/contracts";
import { officeActionRoutes } from "../../../../platform/http/office-action-routes.js";
import { EngineOfficeActions } from "../office-actions/engine-office-actions.js";
import { EngineSettingsRefusalFilter } from "./engine-settings-refusal.filter.js";

/**
 * The routes of Engine's Office actions, each derived from its declaration (ENGINES_OFFICE_ACTIONS):
 * the signed-in user's request goes to the one handler the action's Office tool calls too. A
 * refused save or removal answers 422 with every reason.
 */
@Controller()
@UseFilters(EngineSettingsRefusalFilter)
export class EngineOfficeActionsController extends officeActionRoutes(ENGINES_OFFICE_ACTIONS) {
  constructor(private readonly actions: EngineOfficeActions) {
    super();
  }

  answer(action: OfficeAction, input: unknown): Promise<unknown> {
    return this.actions.answer(action, input);
  }
}

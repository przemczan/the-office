import { Controller } from "@nestjs/common";
import { RUN_ENVIRONMENTS_OFFICE_ACTIONS, type OfficeAction } from "@the-office/contracts";
import { officeActionRoutes } from "../../../../platform/http/office-action-routes.js";
import { RunEnvironmentOfficeActions } from "../office-actions/run-environment-office-actions.js";

/**
 * The routes of Run environments' Office actions, each derived from its declaration
 * (RUN_ENVIRONMENTS_OFFICE_ACTIONS): the signed-in user's request goes to the one handler the
 * action's Office tool calls too.
 */
@Controller()
export class RunEnvironmentOfficeActionsController extends officeActionRoutes(
  RUN_ENVIRONMENTS_OFFICE_ACTIONS,
) {
  constructor(private readonly actions: RunEnvironmentOfficeActions) {
    super();
  }

  answer(action: OfficeAction, input: unknown): Promise<unknown> {
    return this.actions.answer(action, input);
  }
}

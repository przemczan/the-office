import { Controller, UseFilters } from "@nestjs/common";
import { PIPELINES_OFFICE_ACTIONS, type OfficeAction } from "@the-office/contracts";
import { officeActionRoutes } from "../../../../platform/http/office-action-routes.js";
import { userOf, type SignedIn } from "../../../../platform/http/signed-in-requests.js";
import { PipelinesOfficeActions } from "../office-actions/pipelines-office-actions.js";
import { RestartRefusalsFilter } from "./restart-refusals.filter.js";

/**
 * The routes of Pipelines' Office actions, each derived from its declaration
 * (PIPELINES_OFFICE_ACTIONS): the signed-in user's request goes to the one handler the action's
 * Office tool calls too. A refused Restart from… is answered as a refused Gate action is.
 */
@Controller()
@UseFilters(RestartRefusalsFilter)
export class PipelinesOfficeActionsController extends officeActionRoutes(PIPELINES_OFFICE_ACTIONS) {
  constructor(private readonly actions: PipelinesOfficeActions) {
    super();
  }

  answer(action: OfficeAction, input: unknown, signedIn: SignedIn): Promise<unknown> {
    return this.actions.answer(action, input, userOf(signedIn));
  }
}

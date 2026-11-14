import { Controller, UseFilters } from "@nestjs/common";
import { WORK_OFFICE_ACTIONS, type OfficeAction } from "@the-office/contracts";
import { officeActionRoutes } from "../../../../platform/http/office-action-routes.js";
import type { SignedIn } from "../../../../platform/http/signed-in-requests.js";
import { WorkOfficeActions } from "../office-actions/work-office-actions.js";
import { authorOf } from "./signed-in-author.js";
import { WorkRefusalsFilter } from "./work-refusals.filter.js";

/**
 * The routes of Work's Office actions, each derived from its declaration (WORK_OFFICE_ACTIONS):
 * the signed-in user's request goes to the one handler the action's Office tool calls too.
 */
@Controller()
@UseFilters(WorkRefusalsFilter)
export class WorkOfficeActionsController extends officeActionRoutes(WORK_OFFICE_ACTIONS) {
  constructor(private readonly actions: WorkOfficeActions) {
    super();
  }

  answer(action: OfficeAction, input: unknown, signedIn: SignedIn): Promise<unknown> {
    return this.actions.answer(action, input, authorOf(signedIn));
  }
}

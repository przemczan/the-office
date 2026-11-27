import { Controller, UseFilters } from "@nestjs/common";
import { PEOPLE_OFFICE_ACTIONS, type OfficeAction } from "@the-office/contracts";
import { officeActionRoutes } from "../../../../platform/http/office-action-routes.js";
import { userOf, type SignedIn } from "../../../../platform/http/signed-in-requests.js";
import { PeopleOfficeActions } from "../office-actions/people-office-actions.js";
import { RoleRefusalsFilter } from "./role-refusals.filter.js";

/**
 * The routes of People's Office actions, each derived from its declaration (PEOPLE_OFFICE_ACTIONS):
 * the signed-in user's request goes to the one handler the action's Office tool calls too. The
 * user may act on any person's Memory and Avatar.
 */
@Controller()
@UseFilters(RoleRefusalsFilter)
export class PeopleOfficeActionsController extends officeActionRoutes(PEOPLE_OFFICE_ACTIONS) {
  constructor(private readonly actions: PeopleOfficeActions) {
    super();
  }

  answer(action: OfficeAction, input: unknown, signedIn: SignedIn): Promise<unknown> {
    return this.actions.answer(action, input, userOf(signedIn));
  }
}

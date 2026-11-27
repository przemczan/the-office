import { Controller, UseFilters } from "@nestjs/common";
import { SKILLS_OFFICE_ACTIONS, type OfficeAction } from "@the-office/contracts";
import { officeActionRoutes } from "../../../../platform/http/office-action-routes.js";
import { userOf, type SignedIn } from "../../../../platform/http/signed-in-requests.js";
import { SkillOfficeActions } from "../office-actions/skill-office-actions.js";
import { SkillRefusalsFilter } from "./skill-refusals.filter.js";

/**
 * The routes of the skill library's Office actions, each derived from its declaration
 * (SKILLS_OFFICE_ACTIONS): the signed-in user's request goes to the one handler the action's Office
 * tool calls too. A refused change answers 422 with its reasons, a missing skill 404.
 */
@Controller()
@UseFilters(SkillRefusalsFilter)
export class SkillOfficeActionsController extends officeActionRoutes(SKILLS_OFFICE_ACTIONS) {
  constructor(private readonly actions: SkillOfficeActions) {
    super();
  }

  answer(action: OfficeAction, input: unknown, signedIn: SignedIn): Promise<unknown> {
    return this.actions.answer(action, input, userOf(signedIn));
  }
}

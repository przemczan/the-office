import { Controller, UseFilters } from "@nestjs/common";
import { PROMPT_TEMPLATES_OFFICE_ACTIONS, type OfficeAction } from "@the-office/contracts";
import { officeActionRoutes } from "../../../../platform/http/office-action-routes.js";
import { userOf, type SignedIn } from "../../../../platform/http/signed-in-requests.js";
import { PromptTemplateOfficeActions } from "../office-actions/prompt-template-office-actions.js";
import { PromptTemplateActionRefusalsFilter } from "./prompt-template-refusals.filter.js";

/**
 * The routes of the Prompt templates' Office actions, each derived from its declaration
 * (PROMPT_TEMPLATES_OFFICE_ACTIONS): the signed-in user's request goes to the one handler the
 * action's Office tool calls too. A refused text answers with every problem and where it is.
 */
@Controller()
@UseFilters(PromptTemplateActionRefusalsFilter)
export class PromptTemplateOfficeActionsController extends officeActionRoutes(
  PROMPT_TEMPLATES_OFFICE_ACTIONS,
) {
  constructor(private readonly actions: PromptTemplateOfficeActions) {
    super();
  }

  answer(action: OfficeAction, input: unknown, signedIn: SignedIn): Promise<unknown> {
    return this.actions.answer(action, input, userOf(signedIn));
  }
}

import { Controller, UseFilters } from "@nestjs/common";
import { PROJECT_OFFICE_ACTIONS, type OfficeAction } from "@the-office/contracts";
import { officeActionRoutes } from "../../../../platform/http/office-action-routes.js";
import { ProjectOfficeActions } from "../office-actions/project-office-actions.js";
import { ProjectRefusalsFilter } from "./project-refusals.filter.js";

/**
 * The routes of Projects' Office actions, each derived from its declaration
 * (PROJECT_OFFICE_ACTIONS): the signed-in user's request goes to the one handler the action's
 * Office tool calls too. A code host's refusal comes back as a ProjectRefused, answered 422.
 */
@Controller()
@UseFilters(ProjectRefusalsFilter)
export class ProjectOfficeActionsController extends officeActionRoutes(PROJECT_OFFICE_ACTIONS) {
  constructor(private readonly actions: ProjectOfficeActions) {
    super();
  }

  answer(action: OfficeAction, input: unknown): Promise<unknown> {
    return this.actions.answer(action, input);
  }
}

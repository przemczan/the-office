import { Controller, UseFilters } from "@nestjs/common";
import {
  CLOSE_PULL_REQUEST_ACTION,
  PROJECT_OFFICE_ACTIONS,
  type OfficeAction,
} from "@the-office/contracts";
import { officeActionRoutes } from "../../../../platform/http/office-action-routes.js";
import { userOf, type SignedIn } from "../../../../platform/http/signed-in-requests.js";
import { ProjectOfficeActions } from "../office-actions/project-office-actions.js";
import { ProjectRefusalsFilter } from "./project-refusals.filter.js";
import { PullRequestRefusalsFilter } from "./pull-request-refusals.filter.js";

/**
 * The routes of Projects' Office actions, each derived from its declaration
 * (PROJECT_OFFICE_ACTIONS): the signed-in user's request goes to the one handler the action's
 * Office tool calls too. A code host's refusal comes back as a ProjectRefused, answered 422; a
 * refused close of a pull request answers as Work › Pull requests does, 409 `{ reason, refresh }`.
 */
@Controller()
@UseFilters(ProjectRefusalsFilter)
export class ProjectOfficeActionsController extends officeActionRoutes(PROJECT_OFFICE_ACTIONS) {
  constructor(private readonly actions: ProjectOfficeActions) {
    super();
  }

  answer(action: OfficeAction, input: unknown, signedIn: SignedIn): Promise<unknown> {
    return this.actions.answer(action, input, userOf(signedIn));
  }
}

// On the close route alone, ahead of the class's filter: a test instance's refusal of it answers
// `{ reason, refresh }` too, as the web reads every refused close.
const routes = Object.getPrototypeOf(ProjectOfficeActionsController.prototype) as object;
const close = Object.getOwnPropertyDescriptor(routes, CLOSE_PULL_REQUEST_ACTION.name);
if (close === undefined) throw new Error("The close route of a pull request was not made.");
UseFilters(PullRequestRefusalsFilter)(routes, CLOSE_PULL_REQUEST_ACTION.name, close);

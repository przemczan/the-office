import { Controller } from "@nestjs/common";
import { GITHUB_OFFICE_ACTIONS, type OfficeAction } from "@the-office/contracts";
import { officeActionRoutes } from "../../../../platform/http/office-action-routes.js";
import { GitHubOfficeActions } from "../office-actions/github-office-actions.js";

/**
 * The routes of GitHub's Office actions, each derived from its declaration (GITHUB_OFFICE_ACTIONS):
 * the signed-in user's request goes to the one handler the action's Office tool calls too.
 */
@Controller()
export class GitHubOfficeActionsController extends officeActionRoutes(GITHUB_OFFICE_ACTIONS) {
  constructor(private readonly actions: GitHubOfficeActions) {
    super();
  }

  answer(action: OfficeAction): Promise<unknown> {
    return this.actions.answer(action);
  }
}

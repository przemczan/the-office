import { Controller } from "@nestjs/common";
import { CONVERSATIONS_SETTINGS_OFFICE_ACTIONS, type OfficeAction } from "@the-office/contracts";
import { officeActionRoutes } from "../../../../platform/http/office-action-routes.js";
import { userOf, type SignedIn } from "../../../../platform/http/signed-in-requests.js";
import { ConversationsSettingsOfficeActions } from "../office-actions/conversations-settings-office-actions.js";

/**
 * The routes of Conversations' Office settings actions, each derived from its declaration
 * (CONVERSATIONS_SETTINGS_OFFICE_ACTIONS): the signed-in user's request goes to the one handler
 * the action's Office tool calls too.
 */
@Controller()
export class ConversationsSettingsOfficeActionsController extends officeActionRoutes(
  CONVERSATIONS_SETTINGS_OFFICE_ACTIONS,
) {
  constructor(private readonly actions: ConversationsSettingsOfficeActions) {
    super();
  }

  answer(action: OfficeAction, input: unknown, signedIn: SignedIn): Promise<unknown> {
    return this.actions.answer(action, input, userOf(signedIn));
  }
}

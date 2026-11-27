import { Controller } from "@nestjs/common";
import { TELEMETRY_OFFICE_ACTIONS, type OfficeAction } from "@the-office/contracts";
import { officeActionRoutes } from "../../../../platform/http/office-action-routes.js";
import { TelemetryOfficeActions } from "../office-actions/telemetry-office-actions.js";

/**
 * The routes of Telemetry's Office actions, each derived from its declaration
 * (TELEMETRY_OFFICE_ACTIONS): the signed-in user's request goes to the one handler the action's
 * Office tool calls too.
 */
@Controller()
export class TelemetryOfficeActionsController extends officeActionRoutes(TELEMETRY_OFFICE_ACTIONS) {
  constructor(private readonly actions: TelemetryOfficeActions) {
    super();
  }

  answer(action: OfficeAction, input: unknown): Promise<unknown> {
    return this.actions.answer(action, input);
  }
}

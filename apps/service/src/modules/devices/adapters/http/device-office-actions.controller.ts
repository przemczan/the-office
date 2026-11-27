import { Controller, UseFilters } from "@nestjs/common";
import { DEVICE_OFFICE_ACTIONS, type OfficeAction } from "@the-office/contracts";
import { officeActionRoutes } from "../../../../platform/http/office-action-routes.js";
import { SignedIn, userOf } from "../../../../platform/http/signed-in-requests.js";
import { DeviceOfficeActions } from "../office-actions/device-office-actions.js";
import { DeviceRefusalsFilter } from "./device-refusals.filter.js";

/**
 * The routes of Devices' Office actions, each derived from its declaration (DEVICE_OFFICE_ACTIONS):
 * the signed-in user's request goes to the one handler the action's Office tool calls too.
 */
@Controller()
@UseFilters(DeviceRefusalsFilter)
export class DeviceOfficeActionsController extends officeActionRoutes(DEVICE_OFFICE_ACTIONS) {
  constructor(private readonly actions: DeviceOfficeActions) {
    super();
  }

  answer(action: OfficeAction, input: unknown, signedIn: SignedIn): Promise<unknown> {
    return this.actions.answer(action, input, userOf(signedIn));
  }
}

import { Controller, UseFilters } from "@nestjs/common";
import { TEST_INSTANCE_OFFICE_ACTIONS, type OfficeAction } from "@the-office/contracts";
import type { Request } from "express";
import { OfficeAddresses } from "../../../../platform/http/office-addresses.js";
import { officeActionRoutes } from "../../../../platform/http/office-action-routes.js";
import { SignedIn, userOf } from "../../../../platform/http/signed-in-requests.js";
import {
  TestInstanceOfficeActions,
  type RequestPage,
} from "../office-actions/test-instance-office-actions.js";
import { hostnameOf } from "../proxy/proxy-hosts.js";
import { TestInstanceRefusalsFilter } from "./test-instance-refusals.filter.js";

/**
 * The routes of Test instances' Office actions, each derived from its declaration
 * (TEST_INSTANCE_OFFICE_ACTIONS): the signed-in user's request goes to the one handler the action's
 * Office tool calls too, with the address the page was opened at.
 */
@Controller()
@UseFilters(TestInstanceRefusalsFilter)
export class TestInstanceOfficeActionsController extends officeActionRoutes(
  TEST_INSTANCE_OFFICE_ACTIONS,
) {
  constructor(
    private readonly actions: TestInstanceOfficeActions,
    private readonly addresses: OfficeAddresses,
  ) {
    super();
  }

  answer(
    action: OfficeAction,
    input: unknown,
    signedIn: SignedIn,
    request: Request,
  ): Promise<unknown> {
    const page: RequestPage = {
      hostname: hostnameOf(request.headers.host ?? "localhost"),
      origin: `${request.protocol}://${request.host}`,
      address: this.addresses.addressOf(request),
    };
    return this.actions.answer(action, input, { kind: "user", user: userOf(signedIn) }, page);
  }
}

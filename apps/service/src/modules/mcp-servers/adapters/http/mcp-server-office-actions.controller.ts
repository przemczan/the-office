import { Controller, UseFilters } from "@nestjs/common";
import { MCP_SERVERS_OFFICE_ACTIONS, type OfficeAction } from "@the-office/contracts";
import { officeActionRoutes } from "../../../../platform/http/office-action-routes.js";
import { McpServerOfficeActions } from "../office-actions/mcp-server-office-actions.js";
import { McpServerRefusalsFilter } from "./mcp-server-refusals.filter.js";

/**
 * The routes of the MCP server library's Office actions, each derived from its declaration
 * (MCP_SERVERS_OFFICE_ACTIONS): the signed-in user's request goes to the one handler the action's
 * Office tool calls too. A refusal answers 422 with its reasons, an unknown server 404.
 */
@Controller()
@UseFilters(McpServerRefusalsFilter)
export class McpServerOfficeActionsController extends officeActionRoutes(
  MCP_SERVERS_OFFICE_ACTIONS,
) {
  constructor(private readonly actions: McpServerOfficeActions) {
    super();
  }

  answer(action: OfficeAction, input: unknown): Promise<unknown> {
    return this.actions.answer(action, input);
  }
}

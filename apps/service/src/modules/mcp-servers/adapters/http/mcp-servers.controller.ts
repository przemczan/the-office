import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseFilters,
} from "@nestjs/common";
import {
  pastedConfigSchema,
  type McpServer as McpServerResponse,
  type McpServerReview as McpServerReviewResponse,
  type NewMcpServer as NewMcpServerMessage,
  type PastedConfig,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { McpServerLibrary } from "../../application/mcp-server-library.js";
import { RoleMcpServers } from "../../application/role-mcp-servers.js";
import { McpServerRefusalsFilter } from "./mcp-server-refusals.filter.js";
import {
  toMcpServerResponse,
  toNewMcpServerMessage,
  toReviewResponse,
} from "./mcp-server-responses.js";

/**
 * Settings › MCP servers: what the library reads, each secret's value never sent back. What it
 * changes is its Office actions' routes (`McpServerOfficeActionsController`).
 */
@Controller("mcp-servers")
@UseFilters(McpServerRefusalsFilter)
export class McpServersController {
  constructor(
    private readonly library: McpServerLibrary,
    private readonly roleServers: RoleMcpServers,
  ) {}

  @Get()
  async list(): Promise<McpServerResponse[]> {
    const roles = await this.roleServers.byServer();
    return (await this.library.list()).map((server) =>
      toMcpServerResponse(server, roles.get(server.name) ?? []),
    );
  }

  /** Reads a pasted config for the form, which the user checks before adding; keeps nothing. */
  @Post("pasted-config")
  @HttpCode(HttpStatus.OK)
  readPastedConfig(
    @Body(new ContractPipe(pastedConfigSchema)) { config }: PastedConfig,
  ): NewMcpServerMessage {
    return toNewMcpServerMessage(this.library.readPastedConfig(config));
  }

  @Get(":name")
  async read(@Param("name") name: string): Promise<McpServerResponse> {
    const server = await this.library.read(name);
    return toMcpServerResponse(server, await this.rolesOf(name));
  }

  /** Connects with the Office-wide values: the user reviews what runs and the tools it lists. */
  @Get(":name/review")
  async review(@Param("name") name: string): Promise<McpServerReviewResponse> {
    const review = await this.library.review(name);
    return toReviewResponse(review, await this.rolesOf(name));
  }

  private async rolesOf(name: string): Promise<readonly string[]> {
    return (await this.roleServers.byServer()).get(name) ?? [];
  }
}

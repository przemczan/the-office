import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UseFilters,
} from "@nestjs/common";
import {
  mcpServerEditSchema,
  mcpServerRolesChangeSchema,
  mcpServerStateChangeSchema,
  newMcpServerSchema,
  pastedConfigSchema,
  type McpServer as McpServerResponse,
  type McpServerEdit as McpServerEditRequest,
  type McpServerReview as McpServerReviewResponse,
  type McpServerRolesChange,
  type McpServerStateChange,
  type McpServerTool as McpServerToolResponse,
  type NewMcpServer as NewMcpServerMessage,
  type PastedConfig,
  type ServerValue as ServerValueResponse,
  type ServerValueEdit as ServerValueEditMessage,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { McpServerLibrary, type McpServerReview } from "../../application/mcp-server-library.js";
import { RoleMcpServers } from "../../application/role-mcp-servers.js";
import {
  toolsTooLongForSessions,
  type McpServer,
  type McpServerConnection,
  type McpServerTool,
  type NewMcpServer,
  type ServerValue,
  type ServerValueEdit,
} from "../../domain/mcp-server.js";
import { McpServerRefusalsFilter } from "./mcp-server-refusals.filter.js";

/** Settings › MCP servers: the library, each secret's value never sent back. */
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

  @Post()
  async add(
    @Body(new ContractPipe(newMcpServerSchema)) newServer: NewMcpServerMessage,
  ): Promise<McpServerResponse> {
    const server = await this.library.add({
      name: newServer.name,
      connection: connectionOf(newServer),
      serverValues: newServer.serverValues.map(toServerValueEdit),
    });
    return toMcpServerResponse(server, []);
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
    return this.response(await this.library.read(name));
  }

  @Put(":name")
  async change(
    @Param("name") name: string,
    @Body(new ContractPipe(mcpServerEditSchema)) edit: McpServerEditRequest,
  ): Promise<McpServerResponse> {
    const server = await this.library.change(name, {
      connection: connectionOf(edit),
      serverValues: edit.serverValues.map(toServerValueEdit),
    });
    return this.response(server);
  }

  /** Connects with the Office-wide values: the user reviews what runs and the tools it lists. */
  @Get(":name/review")
  async review(@Param("name") name: string): Promise<McpServerReviewResponse> {
    const review = await this.library.review(name);
    return toReviewResponse(review, await this.rolesOf(name));
  }

  @Put(":name/state")
  async changeState(
    @Param("name") name: string,
    @Body(new ContractPipe(mcpServerStateChangeSchema)) change: McpServerStateChange,
  ): Promise<McpServerResponse> {
    const server =
      change.state === "on"
        ? this.library.turnOn(name, change.reviewDigest)
        : this.library.turnOff(name);
    return this.response(await server);
  }

  /** The Roles whose Agents get it, from their next sessions on. */
  @Put(":name/roles")
  async assign(
    @Param("name") name: string,
    @Body(new ContractPipe(mcpServerRolesChangeSchema)) { roles }: McpServerRolesChange,
  ): Promise<McpServerResponse> {
    const assigned = await this.roleServers.assignServer(name, roles);
    return toMcpServerResponse(await this.library.read(name), assigned);
  }

  @Delete(":name")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("name") name: string): Promise<void> {
    await this.library.remove(name);
  }

  private async response(server: McpServer): Promise<McpServerResponse> {
    return toMcpServerResponse(server, await this.rolesOf(server.name));
  }

  private async rolesOf(name: string): Promise<readonly string[]> {
    return (await this.roleServers.byServer()).get(name) ?? [];
  }
}

function connectionOf(message: McpServerEditRequest): McpServerConnection {
  return message.transport === "stdio"
    ? { transport: "stdio", command: message.command, arguments: message.arguments }
    : { transport: "streamable-http", url: message.url };
}

function toServerValueEdit({
  name,
  secret,
  required,
  officeWideValue,
}: ServerValueEditMessage): ServerValueEdit {
  return { name, secret, required, ...(officeWideValue !== undefined && { officeWideValue }) };
}

function toMcpServerResponse(
  { name, connection, serverValues, state, tools, addedAt }: McpServer,
  roles: readonly string[],
): McpServerResponse {
  return withConnection(
    {
      name,
      serverValues: serverValues.map(toServerValueResponse),
      state,
      tools: tools.map(toToolResponse),
      roles: [...roles],
      addedAt: addedAt.toISOString(),
    },
    connection,
  );
}

function toReviewResponse(
  review: McpServerReview,
  roles: readonly string[],
): McpServerReviewResponse {
  const server = toMcpServerResponse(review.server, roles);
  return review.connected
    ? {
        server,
        connected: true,
        tools: review.tools.map(toToolResponse),
        toolsTooLong: toolsTooLongForSessions(review.server.name, review.tools),
        reviewDigest: review.reviewDigest,
      }
    : { server, connected: false, problem: review.problem };
}

function toToolResponse({ name, description, inputSchema }: McpServerTool): McpServerToolResponse {
  return { name, description, inputSchema: { ...inputSchema } };
}

function toNewMcpServerMessage({
  name,
  connection,
  serverValues,
}: NewMcpServer): NewMcpServerMessage {
  return withConnection(
    { name, serverValues: serverValues.map((value) => ({ ...value })) },
    connection,
  );
}

/** The message's fields with its command and arguments, or its URL, as the contract lays them. */
function withConnection<Fields extends object>(
  fields: Fields,
  connection: McpServerConnection,
):
  | (Fields & { transport: "stdio"; command: string; arguments: string[] })
  | (Fields & { transport: "streamable-http"; url: string }) {
  return connection.transport === "stdio"
    ? {
        ...fields,
        transport: "stdio",
        command: connection.command,
        arguments: [...connection.arguments],
      }
    : { ...fields, transport: "streamable-http", url: connection.url };
}

function toServerValueResponse({
  name,
  secret,
  required,
  officeWideValue,
}: ServerValue): ServerValueResponse {
  return {
    name,
    secret,
    required,
    ...(!secret && officeWideValue !== undefined && { officeWideValue }),
    officeWideValueSet: officeWideValue !== undefined,
  };
}

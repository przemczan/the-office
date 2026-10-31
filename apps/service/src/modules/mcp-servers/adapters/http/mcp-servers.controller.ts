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
  newMcpServerSchema,
  pastedConfigSchema,
  type McpServer as McpServerResponse,
  type McpServerEdit as McpServerEditRequest,
  type NewMcpServer as NewMcpServerMessage,
  type PastedConfig,
  type ServerValue as ServerValueResponse,
  type ServerValueEdit as ServerValueEditMessage,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { McpServerLibrary } from "../../application/mcp-server-library.js";
import type {
  McpServer,
  McpServerConnection,
  NewMcpServer,
  ServerValue,
  ServerValueEdit,
} from "../../domain/mcp-server.js";
import { McpServerRefusalsFilter } from "./mcp-server-refusals.filter.js";

/** Settings › MCP servers: the library, each secret's value never sent back. */
@Controller("mcp-servers")
@UseFilters(McpServerRefusalsFilter)
export class McpServersController {
  constructor(private readonly library: McpServerLibrary) {}

  @Get()
  async list(): Promise<McpServerResponse[]> {
    return (await this.library.list()).map(toMcpServerResponse);
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
    return toMcpServerResponse(server);
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
    return toMcpServerResponse(await this.library.read(name));
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
    return toMcpServerResponse(server);
  }

  @Delete(":name")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("name") name: string): Promise<void> {
    await this.library.remove(name);
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

function toMcpServerResponse({
  name,
  connection,
  serverValues,
  state,
  addedAt,
}: McpServer): McpServerResponse {
  return withConnection(
    {
      name,
      serverValues: serverValues.map(toServerValueResponse),
      state,
      addedAt: addedAt.toISOString(),
    },
    connection,
  );
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

import type {
  McpServer as McpServerResponse,
  McpServerReview as McpServerReviewResponse,
  McpServerTool as McpServerToolResponse,
  NewMcpServer as NewMcpServerMessage,
  ServerValue as ServerValueResponse,
} from "@the-office/contracts";
import type { McpServerReview } from "../../application/mcp-server-library.js";
import {
  toolsTooLongForSessions,
  type McpServer,
  type McpServerConnection,
  type McpServerTool,
  type NewMcpServer,
  type ServerValue,
} from "../../domain/mcp-server.js";

export function toMcpServerResponse(
  { name, connection, serverValues, state, tools, addedAt }: McpServer,
  roles: readonly string[],
): McpServerResponse {
  return withConnection(
    {
      name,
      serverValues: serverValues.map(toServerValueResponse),
      state,
      tools: tools.map(toToolResponse),
      toolsTooLong: toolsTooLongForSessions(name, tools),
      roles: [...roles],
      addedAt: addedAt.toISOString(),
    },
    connection,
  );
}

export function toReviewResponse(
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

export function toToolResponse({
  name,
  description,
  inputSchema,
}: McpServerTool): McpServerToolResponse {
  return { name, description, inputSchema: { ...inputSchema } };
}

export function toNewMcpServerMessage({
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
export function withConnection<Fields extends object>(
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

export function toServerValueResponse({
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

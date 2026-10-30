import type { HookInput, HookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  All,
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import {
  HOOK_ROUTE,
  MCP_ROUTE,
  SESSION_ENDPOINTS_ROUTE,
  SessionEndpoints,
  type EndpointSession,
} from "../claude-code-p/session-endpoints.js";
import {
  OFFICE_TOOL_PREFIX,
  OFFICE_TOOL_SERVER,
  officeToolAnswer,
  textAnswer,
} from "../claude-code/office-tools.js";

/** What a hook call must hold; the session's hook reads only these fields. */
const hookCallSchema = z.looseObject({ hook_event_name: z.string() });
const preToolUseSchema = z.looseObject({
  hook_event_name: z.literal("PreToolUse"),
  tool_name: z.string(),
  tool_use_id: z.string(),
  tool_input: z.unknown(),
});

const NO_SESSION = "No open Claude Code -p session has this token.";

/**
 * The `localhost` endpoints a Claude Code -p session's engine process reaches with its token
 * (spec §5.4 Defaults): the hook the Office rules answer, and an MCP server with the session's
 * Office tools. The token is also in the Agent's commands' environment, so every Office tool call
 * is judged here again, as the hook judges it.
 */
@Controller(SESSION_ENDPOINTS_ROUTE)
export class SessionEndpointsController {
  constructor(private readonly endpoints: SessionEndpoints) {}

  @Post(HOOK_ROUTE)
  @HttpCode(200)
  async hook(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<HookJSONOutput> {
    const session = this.sessionOf(authorization);
    const call = hookCallSchema.safeParse(body);
    if (!call.success) throw new BadRequestException("Send a Claude Code hook's input as JSON.");
    if (call.data.hook_event_name !== "PreToolUse") return {};
    const preToolUse = preToolUseSchema.safeParse(body);
    if (!preToolUse.success) throw new BadRequestException("A PreToolUse call names its tool.");
    return session.preToolUse(preToolUse.data as HookInput, preToolUse.data.tool_use_id, {
      signal: abandonedSignal(response),
    });
  }

  /** Stateless: a server and transport per request, as the MCP SDK's own stateless example does. */
  @All(MCP_ROUTE)
  async mcp(
    @Headers("authorization") authorization: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const session = this.sessionOf(authorization);
    const server = officeToolServer(session);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    response.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(request, response, request.body);
  }

  private sessionOf(authorization: string | undefined): EndpointSession {
    const session = this.endpoints.sessionOf(authorization);
    if (session === undefined) throw new UnauthorizedException(NO_SESSION);
    return session;
  }
}

/** The session's Office tools, each call refused unless the Office rules allow it. */
function officeToolServer(session: EndpointSession): McpServer {
  const server = new McpServer({ name: OFFICE_TOOL_SERVER, version: "1.0.0" });
  for (const officeTool of session.officeTools) {
    server.registerTool(
      officeTool.name,
      { description: officeTool.description, inputSchema: officeTool.input.shape },
      async (input: Record<string, unknown>) => {
        const decision = await session.decide(`${OFFICE_TOOL_PREFIX}${officeTool.name}`, input);
        if (!decision.allowed) return textAnswer(decision.reason, true);
        return officeToolAnswer(officeTool, input, session.id);
      },
    );
  }
  return server;
}

/** Aborts when the engine stops waiting for the answer before it is sent. */
function abandonedSignal(response: Response): AbortSignal {
  const controller = new AbortController();
  response.on("close", () => {
    if (!response.writableFinished) controller.abort();
  });
  return controller.signal;
}

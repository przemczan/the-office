import type { HookInput, HookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import {
  HOOK_ROUTE,
  SESSION_ENDPOINTS_ROUTE,
  SessionEndpoints,
  type EndpointSession,
} from "../claude-code-p/session-endpoints.js";

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
 * The `localhost` endpoint a Claude Code -p session's engine process reaches with its token (spec
 * §5.4 Defaults): the hook the Office rules answer.
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

  private sessionOf(authorization: string | undefined): EndpointSession {
    const session = this.endpoints.sessionOf(authorization);
    if (session === undefined) throw new UnauthorizedException(NO_SESSION);
    return session;
  }
}

/** Aborts when the engine stops waiting for the answer before it is sent. */
function abandonedSignal(response: Response): AbortSignal {
  const controller = new AbortController();
  response.on("close", () => {
    if (!response.writableFinished) controller.abort();
  });
  return controller.signal;
}

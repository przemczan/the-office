import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";
import { Injectable } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { API_PATH } from "@the-office/contracts";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { ToolDecision } from "../../domain/office-rules.js";
import type { OfficeTool } from "../../ports/office-tool.js";

/** Where the service serves the fallback's sessions, under the API's path. */
export const SESSION_ENDPOINTS_ROUTE = "engine/claude-code-p";
export const HOOK_ROUTE = "hook";
export const MCP_ROUTE = "mcp";

/** A session's token holds 256 random bits, so no other process guesses it. */
const TOKEN_BYTES = 32;

/** What the endpoints answer for one session, as its adapter held it to the Office rules. */
export interface EndpointSession {
  readonly id: string;
  readonly officeTools: readonly OfficeTool[];
  /** The session's `PreToolUse` hook, which also tells its refusals to the session. */
  readonly preToolUse: HookCallback;
  /** Whether the session may call a tool, by the engine's name for it, as its hook decides. */
  decide(tool: string, input: unknown): Promise<ToolDecision>;
}

/** A session's endpoints, which its engine process reaches with the token. */
export interface OpenEndpoints {
  readonly token: string;
  readonly hookUrl: string;
  readonly mcpUrl: string;
  /** Ends the token: every later request with it is refused. */
  close(): void;
}

/**
 * The fallback's sessions the service's endpoints answer, by token (spec §5.4 Defaults). A token
 * is made per session and handed only to its process; it reaches that session's Office tools and
 * hook and nothing else, so an Agent that reads it from its environment gets no more than it has.
 */
@Injectable()
export class SessionEndpoints {
  private readonly byToken = new Map<string, EndpointSession>();

  constructor(private readonly http: HttpAdapterHost) {}

  open(session: EndpointSession): OpenEndpoints {
    const token = randomBytes(TOKEN_BYTES).toString("base64url");
    const base = `${this.origin()}${API_PATH}/${SESSION_ENDPOINTS_ROUTE}`;
    this.byToken.set(token, session);
    return {
      token,
      hookUrl: `${base}/${HOOK_ROUTE}`,
      mcpUrl: `${base}/${MCP_ROUTE}`,
      close: () => this.byToken.delete(token),
    };
  }

  /** The session an `Authorization: Bearer <token>` header names, if its endpoints are open. */
  sessionOf(authorization: string | undefined): EndpointSession | undefined {
    const token = /^Bearer (\S+)$/.exec(authorization ?? "")?.[1];
    return token === undefined ? undefined : this.byToken.get(token);
  }

  /** The service's own address, as it listens on `localhost` (spec §5.1). */
  private origin(): string {
    const address = this.http.httpAdapter?.getHttpServer().address() as AddressInfo | null;
    if (address === null || typeof address !== "object") {
      throw new Error(
        "The service isn't listening yet, so a Claude Code -p session can't reach it.",
      );
    }
    return `http://127.0.0.1:${address.port}`;
  }
}

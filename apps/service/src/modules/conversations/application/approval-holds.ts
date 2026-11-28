import { Injectable } from "@nestjs/common";
import type {
  ApprovalCall,
  ApprovalHold,
  OfficeToolRuled,
  OfficeToolRuling,
} from "../../engine/index.js";

/** A call of an MCP tool waiting on approval, with the tool's description as its server listed it. */
export interface HeldMcpToolCall extends ApprovalCall {
  readonly description?: string | undefined;
}

/** The MCP servers a session runs, as far as a held call's card reads them: their tools' words. */
type SessionMcpTools = readonly {
  readonly name: string;
  readonly tools: readonly { readonly name: string; readonly description: string }[];
}[];

type Holder = (sessionId: string, call: HeldMcpToolCall) => Promise<string | undefined>;

/**
 * Where the sessions' settings find how a call waiting on approval is held, and how every Office
 * tool call is ruled. `HeldCalls` and `OfficeToolRulings` fill it: they reach the runners through
 * Consultations, so the runners can't take them themselves.
 */
@Injectable()
export class ApprovalHolds {
  private holder: Holder | undefined;
  private ruler: OfficeToolRuling | undefined;

  holdWith(holder: Holder): void {
    this.holder = holder;
  }

  ruleWith(ruler: OfficeToolRuling): void {
    this.ruler = ruler;
  }

  /** The ruling of every Office tool call; a call is held until `OfficeToolRulings` has filled it. */
  get ruling(): OfficeToolRuling {
    return {
      rule: (call, tool, input): Promise<OfficeToolRuled> =>
        this.ruler
          ? this.ruler.rule(call, tool, input)
          : Promise.resolve({
              kind: "hold",
              words: "The Office can't rule this call yet; try it again shortly.",
            }),
    };
  }

  /**
   * The hold of the session running `mcpServers`, which gives each held call its tool's
   * description; a call is refused until `HeldCalls` has filled it.
   */
  of(sessionId: string, mcpServers: SessionMcpTools): ApprovalHold {
    return (call) =>
      this.holder
        ? this.holder(sessionId, { ...call, description: toolDescription(mcpServers, call) })
        : Promise.resolve("The Office can't ask for approval yet; try the call again shortly.");
  }
}

function toolDescription(mcpServers: SessionMcpTools, call: ApprovalCall): string | undefined {
  const server = mcpServers.find(({ name }) => name === call.server);
  return server?.tools.find(({ name }) => name === call.tool)?.description || undefined;
}

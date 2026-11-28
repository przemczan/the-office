import { canonicalJson } from "../../domain/canonical-json.js";

/** What the session's endpoint answers a Role's MCP server call the Office rules never ruled on. */
export const UNRULED_MCP_CALL_REFUSAL =
  "Refused by The Office: this call didn't come to the Office rules first, so it wasn't made.";

/**
 * The calls of a Role's MCP servers the Office rules allowed on Codex's approval request
 * (`mcpServer/elicitation/request`) and the session's endpoint hasn't forwarded yet, so the
 * endpoint forwards only a call the rules ruled on, once for each time they allowed it, and never
 * one Codex made without asking. A call is the server, the tool and its arguments, read the same
 * whatever the order of their keys.
 */
export class RuledMcpCalls {
  private readonly allowed = new Map<string, number>();

  /** The rules allowed the call: the endpoint may forward it once. */
  allow(server: string, tool: string, input: unknown): void {
    const key = keyOf(server, tool, input);
    this.allowed.set(key, (this.allowed.get(key) ?? 0) + 1);
  }

  /** Whether the rules allowed the call and it wasn't forwarded since; takes that allowance. */
  take(server: string, tool: string, input: unknown): boolean {
    const key = keyOf(server, tool, input);
    const left = this.allowed.get(key) ?? 0;
    if (left === 0) return false;
    if (left === 1) this.allowed.delete(key);
    else this.allowed.set(key, left - 1);
    return true;
  }
}

function keyOf(server: string, tool: string, input: unknown): string {
  return canonicalJson([server, tool, input ?? {}]);
}

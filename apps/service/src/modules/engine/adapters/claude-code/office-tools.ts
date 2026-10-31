import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { OfficeTool } from "../../ports/office-tool.js";

/** Runs an Office tool for a session's call, its input checked against the tool's schema by MCP. */
export async function officeToolAnswer(
  officeTool: OfficeTool,
  input: Record<string, unknown>,
  sessionId: string,
): Promise<CallToolResult> {
  const result = await officeTool.run(input, { sessionId });
  return textAnswer(result.text, result.isError);
}

/** A text answer, which the Agent reads as a failed call when `isError`. */
export function textAnswer(text: string, isError: boolean): CallToolResult {
  return { content: [{ type: "text", text }], isError };
}

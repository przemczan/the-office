import type { ToolDecision } from "../../domain/office-rules.js";
import type { OfficeTool, OfficeToolCall } from "../../ports/office-tool.js";
import { OFFICE_TOOL_PREFIX } from "../office-rules/office-tool-names.js";
import { builtInTool, failure, type BuiltInTool } from "./built-in-tool.js";

/** Whether the session may make a call, by the tool's name as the model calls it. */
export type CallJudge = (tool: string, input: unknown) => Promise<ToolDecision>;

/**
 * An Office tool as the model calls it, under `OFFICE_TOOL_PREFIX` as on the Claude Code engines.
 * It is judged by the Office rules and the session's `ToolHold` again as it runs, as the `-p`
 * adapter's `OfficeToolServer` does, since a hold may begin between the loop's judging and the run.
 */
export function officeBuiltInTool(
  officeTool: OfficeTool,
  call: OfficeToolCall,
  judge: CallJudge,
): BuiltInTool {
  const name = `${OFFICE_TOOL_PREFIX}${officeTool.name}`;
  const tool = builtInTool({
    name,
    description: officeTool.description,
    input: officeTool.input,
    run: async (input) => {
      const decision = await judge(name, input);
      if (!decision.allowed) return failure(decision.reason);
      return officeTool.run(input, call);
    },
  });
  return { ...tool, officeTool: true };
}

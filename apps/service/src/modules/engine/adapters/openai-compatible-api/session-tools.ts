import type { ProcessTrees } from "../../../../platform/os/process-trees.js";
import type { AgentShellProgram } from "../../../../platform/os/shell.js";
import type { OfficeTool } from "../../ports/office-tool.js";
import type { JsonSchema } from "../../ports/session-options.js";
import type { BackgroundCommands } from "./background-commands.js";
import type { BuiltInTool } from "./built-in-tool.js";
import type { ToolDefinition } from "./chat-completions.js";
import { EDIT_TOOL } from "./edit-tool.js";
import { GLOB_TOOL } from "./glob-tool.js";
import { GREP_TOOL } from "./grep-tool.js";
import { officeBuiltInTool, type CallJudge } from "./office-tool.js";
import { READ_TOOL } from "./read-tool.js";
import { shellTool } from "./shell-tool.js";
import { structuredOutputTool } from "./structured-output-tool.js";
import { taskStopTool } from "./task-stop-tool.js";
import { WRITE_TOOL } from "./write-tool.js";

/** The file tools, under the Claude Code engines' names, so the same Office rules judge them. */
const FILE_TOOLS: readonly BuiltInTool[] = [READ_TOOL, GREP_TOOL, GLOB_TOOL, EDIT_TOOL, WRITE_TOOL];

/** What a session's tools are made of beside the file tools. */
export interface SessionToolParts {
  /** The system's shells, as the SDK adapter's tool list has them per system. */
  readonly agentShells: readonly AgentShellProgram[];
  readonly processTrees: ProcessTrees;
  /** The session's commands run in the background, which the shells start and TaskStop stops. */
  readonly backgroundCommands: BackgroundCommands;
  readonly sessionId: string;
  readonly officeTools: readonly OfficeTool[];
  /** Judges an Office tool's call again as it runs. */
  readonly judge: CallJudge;
  /** When set, the session answers through StructuredOutput. */
  readonly outputSchema: JsonSchema | undefined;
}

/** The tools a session gives its model, the same in each of its requests. */
export class SessionTools {
  private readonly byName: ReadonlyMap<string, BuiltInTool>;

  constructor(tools: readonly BuiltInTool[]) {
    this.byName = new Map(tools.map((tool) => [tool.name, tool]));
  }

  static of(parts: SessionToolParts): SessionTools {
    return new SessionTools([
      ...FILE_TOOLS,
      ...parts.agentShells.map((shell) =>
        shellTool(shell, parts.processTrees, parts.backgroundCommands),
      ),
      taskStopTool(parts.backgroundCommands),
      ...parts.officeTools.map((tool) => officeBuiltInTool(tool, parts.sessionId, parts.judge)),
      ...(parts.outputSchema === undefined ? [] : [structuredOutputTool(parts.outputSchema)]),
    ]);
  }

  /** In one order every time, so the request's prefix stays the same for the server's cache. */
  get definitions(): readonly ToolDefinition[] {
    return [...this.byName.values()].map((tool) => tool.definition);
  }

  get names(): readonly string[] {
    return [...this.byName.keys()];
  }

  named(name: string): BuiltInTool | undefined {
    return this.byName.get(name);
  }
}

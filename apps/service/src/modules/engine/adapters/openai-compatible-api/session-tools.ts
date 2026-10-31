import type { BuiltInTool } from "./built-in-tool.js";
import type { ToolDefinition } from "./chat-completions.js";
import { EDIT_TOOL } from "./edit-tool.js";
import { GLOB_TOOL } from "./glob-tool.js";
import { GREP_TOOL } from "./grep-tool.js";
import { READ_TOOL } from "./read-tool.js";
import { WRITE_TOOL } from "./write-tool.js";

/** The file tools, under the Claude Code engines' names, so the same Office rules judge them. */
const FILE_TOOLS: readonly BuiltInTool[] = [READ_TOOL, GREP_TOOL, GLOB_TOOL, EDIT_TOOL, WRITE_TOOL];

/** The tools a session gives its model, the same on every system and in every session. */
export class SessionTools {
  private readonly byName: ReadonlyMap<string, BuiltInTool>;

  constructor(tools: readonly BuiltInTool[] = FILE_TOOLS) {
    this.byName = new Map(tools.map((tool) => [tool.name, tool]));
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

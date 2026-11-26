import { Injectable } from "@nestjs/common";
import type { z } from "zod";
import type { OfficeTool } from "../ports/office-tool.js";
import type { OfficeToolRuling } from "../ports/office-tool-ruling.js";

/** What an engine accepts as a tool's name, as Office tools name themselves: snake_case. */
const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * Every Office tool the modules give Agents, run in-process (spec §5.4). A module registers its
 * tools once, at start; a session gets the ones its caller names.
 */
@Injectable()
export class OfficeToolRegistry {
  private readonly tools = new Map<string, OfficeTool>();

  /** Takes the tool's input type from its schema, so its handler is typed. */
  register<Input extends z.ZodObject>(tool: OfficeTool<Input>): void {
    if (!TOOL_NAME.test(tool.name)) {
      throw new Error(`"${tool.name}" is not an Office tool's name: write it in snake_case.`);
    }
    if (this.tools.has(tool.name)) {
      throw new Error(`An Office tool named ${tool.name} is registered already.`);
    }
    this.tools.set(tool.name, tool);
  }

  /** Every Office action's tool, in the order registered, with the group of the Authority that rules it. */
  actionTools(): { readonly name: string; readonly group: string }[] {
    return [...this.tools.values()].flatMap(({ name, authority }) =>
      authority === undefined ? [] : [{ name, group: authority.group }],
    );
  }

  /**
   * The tools of these names, in their order, each running only as `ruling` lets its call; throws
   * naming those no module registered.
   */
  named(names: readonly string[], ruling: OfficeToolRuling): OfficeTool[] {
    const unknown = names.filter((name) => !this.tools.has(name));
    if (unknown.length > 0) {
      throw new Error(`No Office tool is registered as ${unknown.join(", ")}.`);
    }
    return names.map((name) => ruled(this.tools.get(name) as OfficeTool, ruling));
  }
}

function ruled(tool: OfficeTool, ruling: OfficeToolRuling): OfficeTool {
  return {
    ...tool,
    async run(input, call) {
      const answer = await ruling.rule(call, tool, input);
      switch (answer.kind) {
        case "run":
          return tool.run(
            input,
            answer.allowedBy ? { ...call, allowedBy: answer.allowedBy } : call,
          );
        case "hold":
          return { text: answer.words, isError: true };
        case "never":
          return { text: `No Office tool is registered as ${tool.name}.`, isError: true };
      }
    },
  };
}

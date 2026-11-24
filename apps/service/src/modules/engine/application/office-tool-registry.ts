import { Injectable } from "@nestjs/common";
import type { z } from "zod";
import type { OfficeTool, OfficeToolCover } from "../ports/office-tool.js";

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

  /** The tools of these names, in their order; throws naming those no module registered. */
  named(names: readonly string[]): OfficeTool[] {
    const unknown = names.filter((name) => !this.tools.has(name));
    if (unknown.length > 0) {
      throw new Error(`No Office tool is registered as ${unknown.join(", ")}.`);
    }
    return names.map((name) => this.tools.get(name) as OfficeTool);
  }

  /** The names of the Office actions' tools any of `duties` covers, in the order registered. */
  coveredBy(duties: readonly string[]): string[] {
    return this.namesWhere(
      (cover) => cover.kind === "duties" && cover.duties.some((duty) => duties.includes(duty)),
    );
  }

  /**
   * The names of the Office actions' tools covered by whoever creates one of `records`, in the
   * order registered.
   */
  coveredByCreatorsOf(records: readonly string[]): string[] {
    return this.namesWhere((cover) => cover.kind === "creators" && records.includes(cover.record));
  }

  private namesWhere(covers: (cover: OfficeToolCover) => boolean): string[] {
    return [...this.tools.values()]
      .filter(({ coveredBy }) => coveredBy !== undefined && covers(coveredBy))
      .map(({ name }) => name);
  }
}

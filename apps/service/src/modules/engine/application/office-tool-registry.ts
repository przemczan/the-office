import { Injectable } from "@nestjs/common";
import type { z } from "zod";
import { fingerprintOf } from "../domain/canonical-json.js";
import type {
  OfficeTool,
  OfficeToolApplication,
  OfficeToolChangedField,
  OfficeToolRedactedInput,
  OfficeToolResult,
  OfficeToolSubject,
} from "../ports/office-tool.js";
import type { OfficeToolRuling } from "../ports/office-tool-ruling.js";

/** What an engine accepts as a tool's name, as Office tools name themselves: snake_case. */
const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;

/** What a call of an Office action changes, with the fingerprint of what its handler reads and writes. */
export interface DraftedOfficeCall {
  readonly subject: OfficeToolSubject & { readonly title: string };
  readonly fields: readonly OfficeToolChangedField[];
  readonly fingerprint: string;
}

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
  actionTools(): {
    readonly name: string;
    readonly group: string;
    readonly onOwnWork?: string;
  }[] {
    return [...this.tools.values()].flatMap(({ name, authority }) =>
      authority === undefined
        ? []
        : [
            {
              name,
              group: authority.group,
              ...(authority.onOwnWork && { onOwnWork: authority.onOwnWork }),
            },
          ],
    );
  }

  /**
   * What the call changes as it stands now, with its fingerprint; undefined for a tool that can't be
   * drafted, or that no module registered.
   */
  async draft(name: string, input: unknown): Promise<DraftedOfficeCall | undefined> {
    const tool = this.tools.get(name);
    if (!tool?.draft) return undefined;
    const { subject, fields, fingerprint } = await tool.draft(tool.input.parse(input));
    return { subject, fields, fingerprint: fingerprintOf(fingerprint) };
  }

  /**
   * The call's input without its Secret values, as cards show it (`OfficeTool.redact`); the input as
   * given for a tool whose input holds none or that no module registered.
   */
  async redact(name: string, input: unknown): Promise<OfficeToolRedactedInput> {
    const tool = this.tools.get(name);
    if (!tool?.redact) return { shown: input as Record<string, unknown>, hasSecret: false };
    return tool.redact(tool.input.parse(input));
  }

  /** Carries out a call the user applied from a Proposal, as that user (`OfficeTool.applyFor`). */
  async applyFor(
    name: string,
    input: unknown,
    application: OfficeToolApplication,
  ): Promise<OfficeToolResult> {
    const tool = this.tools.get(name);
    if (!tool?.applyFor)
      throw new Error(`The Office tool ${name} can't be applied from a Proposal.`);
    return tool.applyFor(tool.input.parse(input), application);
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
        case "answered":
          return { text: answer.words, isError: false };
        case "never":
          return { text: `No Office tool is registered as ${tool.name}.`, isError: true };
      }
    },
  };
}

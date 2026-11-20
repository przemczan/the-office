import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Json } from "../json.ts";
import type { ToolServer } from "./office-channel.ts";

/** An Office tool the session's `office` server lists. */
export interface OfficeTool {
  readonly name: string;
  readonly description: string;
  /** The tool's JSON schema for its arguments. */
  readonly inputSchema: Json;
  run(input: Json): Promise<OfficeToolAnswer>;
}

export interface OfficeToolAnswer {
  readonly text: string;
  readonly isError?: boolean;
}

/** The skill-loading tool, named and shaped as the adapter's (`SKILL_TOOL`, `SKILL_TOOL_INPUT`). */
export const SKILL_TOOL = "Skill";

/** The tool a turn's answer held to a schema is given through (`STRUCTURED_OUTPUT_TOOL`). */
export const STRUCTURED_OUTPUT_TOOL = "StructuredOutput";

const SKILL_TOOL_SCHEMA = {
  type: "object",
  properties: {
    skill: { type: "string", minLength: 1, description: "The skill name." },
    args: { type: "string", description: "Optional arguments for the skill" },
  },
  required: ["skill"],
} as const;

/** A schema a turn's answer must fit, and how to tell whether an input does. */
export interface OutputSchema {
  readonly schema: Json;
  /** Undefined when the input fits; else what doesn't. */
  check(input: Json): string | undefined;
}

export interface OfficeServerParts {
  readonly officeTools: readonly OfficeTool[];
  /** The session's skills by name, each a whole `SKILL.md`; none for a session without skills. */
  readonly skills: Readonly<Record<string, string>> | undefined;
  readonly outputSchema: OutputSchema | undefined;
}

/**
 * The `office` server as the adapter's `SessionToolServers` serves it (its source of truth): the
 * Office tools, the Skill tool listing the session's skills, and StructuredOutput, whose input
 * schema is the answer's and which takes an answer that fits as the turn's output.
 */
export class OfficeServer implements ToolServer {
  /** Every StructuredOutput input that fit, in order. */
  readonly outputs: Json[] = [];

  private readonly parts: OfficeServerParts;

  constructor(parts: OfficeServerParts) {
    this.parts = parts;
  }

  /** Whether the session has an `office` server at all. */
  get serves(): boolean {
    const { officeTools, skills, outputSchema } = this.parts;
    return officeTools.length > 0 || skills !== undefined || outputSchema !== undefined;
  }

  async listTools(): Promise<Tool[]> {
    const { officeTools, skills, outputSchema } = this.parts;
    return [
      ...officeTools.map(({ name, description, inputSchema }) =>
        tool(name, description, inputSchema),
      ),
      ...(skills === undefined
        ? []
        : [tool(SKILL_TOOL, skillToolDescription(skills), SKILL_TOOL_SCHEMA as unknown as Json)]),
      ...(outputSchema === undefined
        ? []
        : [
            tool(
              STRUCTURED_OUTPUT_TOOL,
              "Gives your final answer in the shape it is asked for. Call it once at the end of your work, with the whole answer as its input.",
              outputSchema.schema,
            ),
          ]),
    ];
  }

  async callTool(name: string, input: Json): Promise<CallToolResult> {
    const { officeTools, skills, outputSchema } = this.parts;
    if (name === SKILL_TOOL && skills !== undefined) return skillCalled(skills, input);
    if (name === STRUCTURED_OUTPUT_TOOL && outputSchema !== undefined) {
      const problem = outputSchema.check(input);
      if (problem !== undefined) return textAnswer(problem, true);
      this.outputs.push(input);
      return textAnswer("Structured output provided successfully", false);
    }
    const officeTool = officeTools.find((candidate) => candidate.name === name);
    if (officeTool === undefined) return textAnswer(`No Office tool ${name}.`, true);
    const answer = await officeTool.run(input);
    return textAnswer(answer.text, answer.isError ?? false);
  }
}

function tool(name: string, description: string, inputSchema: Json): Tool {
  return { name, description, inputSchema: inputSchema as Tool["inputSchema"] };
}

function textAnswer(text: string, isError: boolean): CallToolResult {
  return { content: [{ type: "text", text }], isError };
}

function skillToolDescription(skills: Readonly<Record<string, string>>): string {
  const listing = Object.entries(skills).map(
    ([name, text]) => `- ${name}: ${/^description:\s*(.*)$/m.exec(text)?.[1] ?? ""}`,
  );
  return `Execute a skill within the main conversation. When a task matches one of the available skills, load it with this tool before you start, then follow its instructions.\n\nAvailable skills:\n${listing.join("\n")}`;
}

function skillCalled(skills: Readonly<Record<string, string>>, input: Json): CallToolResult {
  const name =
    input !== null && typeof input === "object" && !Array.isArray(input) ? input["skill"] : null;
  const text = typeof name === "string" ? skills[name] : undefined;
  return text === undefined
    ? textAnswer(`Unknown skill: ${String(name)}`, true)
    : textAnswer(text.replace(/^---\n[\s\S]*?\n---\n/, ""), false);
}

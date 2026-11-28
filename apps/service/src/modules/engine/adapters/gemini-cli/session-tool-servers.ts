import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { SKILL_TOOL } from "../../domain/skill-calls.js";
import type { OfficeTool, OfficeToolCall } from "../../ports/office-tool.js";
import type { JsonSchema, SessionMcpServer } from "../../ports/session-options.js";
import { officeToolAnswer, textAnswer } from "../shared/office-tools.js";
import type { McpServerConnections } from "../mcp-servers/mcp-server-connections.js";
import type { ToolDecider } from "../office-rules/office-tool-call.js";
import { mcpToolName, OFFICE_TOOL_SERVER } from "../office-rules/office-tool-names.js";
import type { ListedSkill } from "../skills/listed-skills.js";
import { SKILL_TOOL_INPUT, skillCalled, skillToolDescription } from "../skills/skill-loading.js";
import {
  outputCheck,
  STRUCTURED_OUTPUT_DESCRIPTION,
  STRUCTURED_OUTPUT_TAKEN,
  STRUCTURED_OUTPUT_TOOL,
} from "../structured-output/structured-output.js";

/** What a session's tool servers are made of. */
export interface SessionToolServerParts {
  readonly officeTools: readonly OfficeTool[];
  /** What the Office tools are told of the session calling them. */
  readonly officeToolCall: OfficeToolCall;
  /** Judges an Office tool's call again as it runs, the session's hold included. */
  readonly decide: ToolDecider;
  /** What the Skill tool lists and loads; undefined for a session with no skill at all. */
  readonly skills: readonly ListedSkill[] | undefined;
  /** The schema a turn's answer must fit, offered as StructuredOutput; none for a reply in words. */
  readonly outputSchema: JsonSchema | undefined;
  /** Takes an answer that fits the schema as the running turn's output. */
  readonly takeOutput: (output: unknown) => void;
  readonly mcpServers: readonly SessionMcpServer[];
  readonly mcpConnections: McpServerConnections;
}

/**
 * The MCP servers a Gemini CLI session's relays serve from the service (spec §5.4.7): `office`, with
 * the Office tools, the Skill tool and StructuredOutput, and each of the Role's MCP servers, run in
 * the service by `McpServerConnections`, so no Server value reaches the CLI. Every call is judged by
 * the hook before it comes here; an Office tool is judged again as it runs, as a hold may begin in
 * between, and an MCP tool is not, which would ask an approval twice.
 */
export class SessionToolServers {
  private readonly checkOutput: ((input: unknown) => string | undefined) | undefined;

  constructor(private readonly parts: SessionToolServerParts) {
    this.checkOutput =
      parts.outputSchema === undefined ? undefined : outputCheck(parts.outputSchema);
  }

  /** Whether the session has an `office` server: Office tools, skills or a schema to answer in. */
  get servesOffice(): boolean {
    const { officeTools, skills, outputSchema } = this.parts;
    return officeTools.length > 0 || skills !== undefined || outputSchema !== undefined;
  }

  /** The servers the CLI is told of, `office` first when it serves any tool. */
  get serverNames(): string[] {
    return [
      ...(this.servesOffice ? [OFFICE_TOOL_SERVER] : []),
      ...this.parts.mcpServers.map(({ name }) => name),
    ];
  }

  listTools(server: string): Promise<Tool[]> {
    if (server === OFFICE_TOOL_SERVER) return Promise.resolve(this.officeServerTools());
    const mcpServer = this.parts.mcpServers.find(({ name }) => name === server);
    if (mcpServer === undefined) return Promise.reject(new Error(`No MCP server ${server}.`));
    return Promise.resolve(
      mcpServer.tools.map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema: inputSchema as Tool["inputSchema"],
      })),
    );
  }

  async callTool(server: string, name: string, input: unknown): Promise<CallToolResult> {
    if (server !== OFFICE_TOOL_SERVER) {
      const answer = await this.parts.mcpConnections.call(server, name, input);
      return textAnswer(answer.text, answer.isError);
    }
    if (name === SKILL_TOOL && this.parts.skills !== undefined) {
      return this.skill(this.parts.skills, input);
    }
    if (name === STRUCTURED_OUTPUT_TOOL && this.checkOutput !== undefined) {
      return this.structuredOutput(this.checkOutput, input);
    }
    const officeTool = this.parts.officeTools.find((tool) => tool.name === name);
    if (officeTool === undefined) return textAnswer(`No Office tool ${name}.`, true);
    return this.officeTool(officeTool, input);
  }

  private officeServerTools(): Tool[] {
    const { officeTools, skills, outputSchema } = this.parts;
    return [
      ...officeTools.map((tool) => mcpTool(tool.name, tool.description, inputSchemaOf(tool.input))),
      ...(skills === undefined
        ? []
        : [mcpTool(SKILL_TOOL, skillToolDescription(skills), inputSchemaOf(SKILL_TOOL_INPUT))]),
      ...(outputSchema === undefined
        ? []
        : [mcpTool(STRUCTURED_OUTPUT_TOOL, STRUCTURED_OUTPUT_DESCRIPTION, outputSchema)]),
    ];
  }

  private async officeTool(officeTool: OfficeTool, input: unknown): Promise<CallToolResult> {
    const decision = await this.parts.decide(
      mcpToolName(OFFICE_TOOL_SERVER, officeTool.name),
      input,
    );
    if (!decision.allowed) return textAnswer(decision.reason, true);
    const parsed = officeTool.input.safeParse(input);
    if (!parsed.success) {
      return textAnswer(`The input doesn't fit: ${z.prettifyError(parsed.error)}`, true);
    }
    return officeToolAnswer(officeTool, parsed.data, this.parts.officeToolCall);
  }

  private async skill(skills: readonly ListedSkill[], input: unknown): Promise<CallToolResult> {
    const parsed = SKILL_TOOL_INPUT.safeParse(input);
    if (!parsed.success) {
      return textAnswer(`The input doesn't fit: ${z.prettifyError(parsed.error)}`, true);
    }
    const loading = await skillCalled(skills, parsed.data.skill, parsed.data.args);
    return loading.loaded ? textAnswer(loading.text, false) : textAnswer(loading.problem, true);
  }

  private structuredOutput(
    check: (input: unknown) => string | undefined,
    input: unknown,
  ): CallToolResult {
    const problem = check(input);
    if (problem !== undefined) return textAnswer(problem, true);
    this.parts.takeOutput(input);
    return textAnswer(STRUCTURED_OUTPUT_TAKEN, false);
  }
}

function mcpTool(name: string, description: string, inputSchema: JsonSchema): Tool {
  return { name, description, inputSchema: inputSchema as Tool["inputSchema"] };
}

function inputSchemaOf(input: z.ZodObject): JsonSchema {
  const { $schema: _schema, ...schema } = z.toJSONSchema(input, { io: "input" });
  return schema;
}

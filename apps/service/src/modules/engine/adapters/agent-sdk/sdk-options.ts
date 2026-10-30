import {
  createSdkMcpServer,
  tool,
  type HookCallback,
  type McpSdkServerConfigWithInstance,
  type Options,
} from "@anthropic-ai/claude-agent-sdk";
import type { AgentShell } from "../../../../platform/os/shell.js";
import type { OfficeTool } from "../../ports/office-tool.js";
import type { SessionOptions } from "../../ports/session-options.js";
import { OFFICE_TOOL_SERVER, officeToolAnswer } from "../claude-code/office-tools.js";
import {
  sessionEnvironment,
  sessionSettings,
  sessionTools,
} from "../claude-code/session-settings.js";

export interface SdkSession {
  readonly id: string;
  /** Whether the session continues an ended one with its conversation. */
  readonly resumes: boolean;
  readonly options: SessionOptions;
  /** The shells Agents run commands in on this system. */
  readonly agentShells: readonly AgentShell[];
  /** Decides every tool call by the Office rules. */
  readonly preToolUse: HookCallback;
  /** Starts the engine's process. */
  readonly spawnProcess: NonNullable<Options["spawnClaudeCodeProcess"]>;
}

/**
 * The Agent SDK's options for one Office session (spec §5.4, §5.6, §6), as the engine check
 * measured them (docs/engine-check.md).
 */
export function sdkOptions({
  id,
  resumes,
  options,
  agentShells,
  preToolUse,
  spawnProcess,
}: SdkSession): Options {
  return {
    cwd: options.folder,
    model: options.model,
    effort: options.effort,
    tools: sessionTools(agentShells),
    settingSources: ["project"],
    plugins:
      options.skills === undefined
        ? []
        : [{ type: "local", path: options.skills.folder, skipMcpDiscovery: true }],
    // The session folder holds only the session's skills; the allowlist keeps the rest unlisted.
    skills: [...(options.skills?.names ?? [])],
    settings: sessionSettings(options),
    permissionPrompts: "none",
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      excludeDynamicSections: true,
      ...(options.instructions !== "" && { append: options.instructions }),
    },
    env: sessionEnvironment(options.environment),
    hooks: { PreToolUse: [{ hooks: [preToolUse] }] },
    ...(options.officeTools.length > 0 && {
      mcpServers: { [OFFICE_TOOL_SERVER]: officeToolServer(options.officeTools, id) },
    }),
    ...(options.outputSchema !== undefined && {
      outputFormat: { type: "json_schema", schema: { ...options.outputSchema } },
    }),
    ...(resumes ? { resume: id } : { sessionId: id }),
    spawnClaudeCodeProcess: spawnProcess,
  };
}

/** Always loaded, so the Agent calls an Office tool without looking it up first. */
function officeToolServer(
  officeTools: readonly OfficeTool[],
  sessionId: string,
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: OFFICE_TOOL_SERVER,
    alwaysLoad: true,
    tools: officeTools.map((officeTool) =>
      tool(officeTool.name, officeTool.description, officeTool.input.shape, (input) =>
        officeToolAnswer(officeTool, input, sessionId),
      ),
    ),
  });
}

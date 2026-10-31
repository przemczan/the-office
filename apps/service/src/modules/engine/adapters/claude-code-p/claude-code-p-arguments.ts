import type { McpSdkServerConfig, Settings } from "@anthropic-ai/claude-agent-sdk";
import type { AgentShell } from "../../../../platform/os/shell.js";
import type { SessionOptions } from "../../ports/session-options.js";
import { OFFICE_TOOL_SERVER } from "../office-rules/office-tool-names.js";
import { sessionSettings, sessionTools } from "../claude-code/session-settings.js";

/**
 * The variable the session's token reaches the engine in, interpolated into the headers it sends
 * the service's hook endpoint, so the token is on no command line. Not a `CLAUDE*`-style name, which the session's
 * environment drops.
 */
export const TOKEN_VARIABLE = "OFFICE_SESSION_TOKEN";

const AUTHORIZATION = { Authorization: `Bearer \${${TOKEN_VARIABLE}}` };

/** Long enough for a call the Office rules hold until the user decides (spec §6). */
const HOOK_TIMEOUT_SECONDS = 600;

export interface ClaudeCodePSession {
  readonly id: string;
  /** Whether the session continues an ended one with its conversation. */
  readonly resumes: boolean;
  readonly options: SessionOptions;
  /** The shells Agents run commands in on this system. */
  readonly agentShells: readonly AgentShell[];
  /** The service's hook endpoint for this session. */
  readonly hookUrl: string;
  /**
   * The file holding the session's instructions, when it has any: on the command line they could
   * pass the 32,767 characters Windows allows it.
   */
  readonly instructionsFile: string | undefined;
}

/**
 * The command line of one session on the pinned binary in `-p` (spec §5.4 Defaults): the flags the
 * SDK passes for the options the SDK adapter gives it, as the engine check found them
 * (docs/engine-check.md, "The `-p` fallback"), with the hook on `localhost` in place of the SDK's
 * in-process one; the Office tools are the service's, through the binary's stream, as on the SDK.
 */
export function claudeCodePArguments(session: ClaudeCodePSession): string[] {
  const { options } = session;
  return [
    "--print",
    "--input-format=stream-json",
    "--output-format=stream-json",
    "--verbose",
    `--model=${options.model}`,
    `--effort=${options.effort}`,
    `--tools=${sessionTools(session.agentShells).join(",")}`,
    "--setting-sources=project",
    // Ticket 22's public flag; the session folder holds skills only, so no plugin MCP server starts.
    ...(options.skills === undefined ? [] : [`--plugin-dir=${options.skills.folder}`]),
    ...skillRules(options),
    `--settings=${JSON.stringify(withHook(session))}`,
    ...(options.officeTools.length > 0
      ? [`--mcp-config=${JSON.stringify({ mcpServers: OFFICE_TOOL_SERVER_CONFIG })}`]
      : []),
    "--permission-prompts=none",
    "--exclude-dynamic-system-prompt-sections",
    ...(session.instructionsFile === undefined
      ? []
      : [`--append-system-prompt-file=${session.instructionsFile}`]),
    ...(options.outputSchema === undefined
      ? []
      : [`--json-schema=${JSON.stringify(options.outputSchema)}`]),
    session.resumes ? `--resume=${session.id}` : `--session-id=${session.id}`,
  ];
}

/** The session's skills, each allowed by rule, as the SDK's `skills` allowlist names them. */
function skillRules({ skills }: SessionOptions): string[] {
  if (skills === undefined || skills.names.length === 0) return [];
  return [`--allowedTools=${skills.names.map((name) => `Skill(${name})`).join(",")}`];
}

/**
 * The Office rules' hook asks the service; `onFailure: 'block'` makes a service that can't be
 * reached refuse the call, where the engine's default would let it go ahead.
 */
function withHook(session: ClaudeCodePSession): Settings {
  return {
    ...sessionSettings(session.options),
    hooks: {
      PreToolUse: [
        {
          hooks: [
            {
              type: "http",
              url: session.hookUrl,
              headers: AUTHORIZATION,
              allowedEnvVars: [TOKEN_VARIABLE],
              timeout: HOOK_TIMEOUT_SECONDS,
              onFailure: "block",
            },
          ],
        },
      ],
    },
  };
}

/** The engine sends this server's messages to the service as `mcp_message` control requests. */
const OFFICE_TOOL_SERVER_CONFIG: Record<string, McpSdkServerConfig> = {
  [OFFICE_TOOL_SERVER]: { type: "sdk", name: OFFICE_TOOL_SERVER },
};

import type { HookEvent, McpSdkServerConfig, Settings } from "@anthropic-ai/claude-agent-sdk";
import { OFFICE_TOOL_SERVER } from "../office-options.ts";

/**
 * The variable the session's token reaches the engine in, interpolated into the headers it sends
 * the local hook endpoint, so the token is on no command line. Not a `CLAUDE*`-style name, which the
 * session's environment drops.
 */
export const TOKEN_VARIABLE = "OFFICE_SESSION_TOKEN";

const AUTHORIZATION = { Authorization: `Bearer \${${TOKEN_VARIABLE}}` };

/** Long enough for a call the Office rules hold until the user decides (spec §6). */
const HOOK_TIMEOUT_SECONDS = 600;

export interface ClaudeCodePOptions {
  readonly model: string;
  readonly tools: readonly string[];
  readonly pluginFolder: string;
  /** Further plugin folders loaded beside the session plugin. */
  readonly additionalPluginFolders?: readonly string[];
  /** `office:<name>` for each session skill, allowed by rule as the SDK's `skills` option does. */
  readonly allowedSkills: readonly string[];
  /** The settings of spec §5.4, §5.6 and §6, without hooks. */
  readonly settings: Settings;
  readonly hookEvents: readonly HookEvent[];
  readonly hookUrl: string;
  /** Whether the session has Office tools, which the host serves through the binary's stream. */
  readonly officeTools: boolean;
  readonly jsonSchema?: Record<string, unknown>;
  readonly session: { readonly id: string; readonly resumes: boolean };
}

/**
 * The command line of one session on the pinned binary in `-p`, the flags the SDK passes for the
 * same options (ticket 22's `-p` fallback line), with the hooks on `localhost` in place of the
 * SDK's in-process ones; the Office tools are the host's, as the SDK's are (spec §5.4 Defaults).
 */
export function claudeCodePArguments(options: ClaudeCodePOptions): string[] {
  const { session } = options;
  return [
    "--print",
    "--input-format=stream-json",
    "--output-format=stream-json",
    "--verbose",
    `--model=${options.model}`,
    `--tools=${options.tools.join(",")}`,
    "--setting-sources=project",
    // Ticket 22's public flag; the session folder holds skills only, so no plugin MCP server starts.
    `--plugin-dir=${options.pluginFolder}`,
    ...(options.additionalPluginFolders ?? []).map((folder) => `--plugin-dir=${folder}`),
    ...(options.allowedSkills.length > 0
      ? [`--allowedTools=${options.allowedSkills.map((skill) => `Skill(${skill})`).join(",")}`]
      : []),
    `--settings=${JSON.stringify(withHooks(options))}`,
    ...(options.officeTools
      ? [`--mcp-config=${JSON.stringify({ mcpServers: OFFICE_TOOL_SERVER_CONFIG })}`]
      : []),
    "--permission-prompts=none",
    "--exclude-dynamic-system-prompt-sections",
    ...(options.jsonSchema === undefined
      ? []
      : [`--json-schema=${JSON.stringify(options.jsonSchema)}`]),
    session.resumes ? `--resume=${session.id}` : `--session-id=${session.id}`,
  ];
}

/**
 * Every hook asks the local endpoint; `onFailure: 'block'` makes an endpoint that can't be reached
 * refuse the call, where the engine's default would let it go ahead.
 */
function withHooks({ settings, hookEvents, hookUrl, officeTools }: ClaudeCodePOptions): Settings {
  return {
    ...settings,
    hooks: Object.fromEntries(
      hookEvents.map((event) => [
        event,
        [
          {
            hooks: [
              {
                type: "http",
                url: hookUrl,
                headers: AUTHORIZATION,
                allowedEnvVars: [TOKEN_VARIABLE],
                timeout: HOOK_TIMEOUT_SECONDS,
                onFailure: "block",
              },
            ],
          },
        ],
      ]),
    ),
    permissions: {
      ...settings.permissions,
      // permissionPrompts "none" refuses whatever would prompt, so the Office tools are allowed by rule.
      allow: [
        ...(settings.permissions?.allow ?? []),
        ...(officeTools ? [`mcp__${OFFICE_TOOL_SERVER}`] : []),
      ],
    },
  };
}

/** The binary asks the host for this server's messages with `mcp_message` control requests. */
const OFFICE_TOOL_SERVER_CONFIG: Record<string, McpSdkServerConfig> = {
  [OFFICE_TOOL_SERVER]: { type: "sdk", name: OFFICE_TOOL_SERVER },
};

import type {
  CopilotClientOptions,
  MCPServerConfig,
  PermissionHandler,
  SessionEventHandler,
  SessionHooks,
  SessionOptionsBase,
  Tool,
} from "@microsoft/copilot-sdk";
import { RuntimeConnection } from "@microsoft/copilot-sdk";
import { COPILOT_CHECK_MODEL, copilotEnvironment, type CopilotAccount } from "./options.ts";

/** What a check asks of a session; everything else is the Office's lean options below. */
export interface CopilotSessionSpec {
  readonly repository: string;
  /** Resumes this session id in the check's config folder instead of creating one. */
  readonly resume?: string;
  /** The built-in, MCP and custom tools the session may use (`tools.availableTools`); every tool when omitted. */
  readonly availableTools?: readonly string[];
  /** Tools the check's own process answers, as the Office answers its tools. */
  readonly officeTools?: readonly Tool[];
  readonly mcpServers?: Readonly<Record<string, MCPServerConfig>>;
  /** Skill loading: off unless given; `directories` are the only roots the Office names. */
  readonly skills?: { readonly directories: readonly string[] };
  /** Built-in Sub-agents the session may start; the runtime's default set when omitted. */
  readonly builtInAgents?: readonly string[];
  /** Turns on the runtime's discovery of the repository's and the folder's own configuration. */
  readonly configDiscovery?: boolean;
  /** Loads the repository's custom instructions (`AGENTS.md`, `.github/copilot-instructions.md`…). */
  readonly customInstructions?: boolean;
}

export interface SessionHandlers {
  readonly hooks: SessionHooks;
  readonly onPermissionRequest: PermissionHandler;
  /** Every event, from before create or resume returns. */
  readonly onEvent: SessionEventHandler;
}

/**
 * The client a check starts per session: its own runtime process over stdio, the bundled runtime of
 * the pinned SDK, `COPILOT_HOME` the check's folder and the token given here, never a signed-in user
 * of the machine (`useLoggedInUser: false`, so no keychain or `gh` sign-in is read).
 */
export function clientOptions(account: CopilotAccount): CopilotClientOptions {
  return {
    mode: "empty",
    runtime: RuntimeConnection.forSpawnedStdio({
      env: { ...copilotEnvironment(), COPILOT_TELEMETRY_DISABLED: "true" },
      baseDirectory: account.home,
    }),
    github: { token: account.token, useLoggedInUser: false },
    observability: { logLevel: "warning" },
  };
}

/**
 * The session's options: the check model, the repository as its working directory, streaming
 * events, no custom instructions, skills, cross-session store, telemetry or co-author trailer unless
 * the spec asks, and the hooks and permission handler that record every call.
 */
export function sessionOptions(
  spec: CopilotSessionSpec,
  handlers: SessionHandlers,
): SessionOptionsBase {
  return {
    model: COPILOT_CHECK_MODEL,
    clientName: "the-office-engine-check",
    workingDirectory: spec.repository,
    enableConfigDiscovery: spec.configDiscovery ?? false,
    instructions: { skipCustomInstructions: !(spec.customInstructions ?? false) },
    skills:
      spec.skills === undefined
        ? { enabled: false }
        : { enabled: true, directories: spec.skills.directories },
    ...(spec.builtInAgents === undefined
      ? {}
      : { agents: { includedBuiltinAgents: spec.builtInAgents } }),
    tools: {
      definitions: spec.officeTools ?? [],
      ...(spec.availableTools === undefined ? {} : { availableTools: spec.availableTools }),
    },
    ...(spec.mcpServers === undefined ? {} : { mcp: { servers: { ...spec.mcpServers } } }),
    events: { streaming: true, onEvent: handlers.onEvent },
    git: { coauthorEnabled: false },
    state: { enableCrossSessionStore: false },
    github: { telemetryEnabled: false },
    hooks: { handlers: handlers.hooks },
    permissions: { onRequest: handlers.onPermissionRequest },
  };
}

import { isOfficeOwnVariable } from "../../../../platform/config/office-config.js";
import { withoutContainerRuntimeVariables } from "../../domain/container-runtime-commands.js";

/** A `-c key=value` override's value, which Codex reads as TOML. */
export type CodexConfigValue = string | number | boolean | readonly CodexConfigValue[];

/**
 * Codex's features that bypass the Office rules or give the model tools The Office doesn't judge
 * (spec §5.4 Defaults): pictures read off the disk, ChatGPT's apps and plugins, Codex's own hooks
 * and memories, image generation, browsers and computer use, its own sub-agents, skill search
 * and installs, goals and tool suggestions. Shell, apply_patch, MCP tools and steering stay. A
 * Codex bump re-reads `codex features list` for new ones.
 */
export const DISABLED_CODEX_FEATURES: readonly string[] = [
  "apps",
  "browser_use",
  "browser_use_external",
  "browser_use_full_cdp_access",
  "computer_use",
  "goals",
  "hooks",
  "image_generation",
  "in_app_browser",
  "memories",
  "multi_agent",
  "plugins",
  "remote_plugin",
  "skill_mcp_dependency_install",
  "skill_search",
  "tool_suggest",
  "view_image",
];

/**
 * The settings every app-server runs with, as `-c` overrides, never written to the engine
 * folder's `config.toml` (spec §5.4 Defaults): the workspace-write sandbox kept to the worktree,
 * without the temporary folders Codex adds and without the network; no update check, web search
 * or history beside the threads; approvals put to The Office, never to Codex's own reviewer;
 * Codex's bundled skills and its listing of skills left out, as a session lists only its own
 * through the `Skill` tool (spec §5.6); a Project's `CLAUDE.md` read where it has no `AGENTS.md`.
 */
export const CODEX_OVERRIDES: Readonly<Record<string, CodexConfigValue>> = {
  "sandbox_workspace_write.exclude_slash_tmp": true,
  "sandbox_workspace_write.exclude_tmpdir_env_var": true,
  "sandbox_workspace_write.network_access": false,
  check_for_update_on_startup: false,
  web_search: "disabled",
  "history.persistence": "none",
  approvals_reviewer: "user",
  "skills.bundled.enabled": false,
  "skills.include_instructions": false,
  project_doc_fallback_filenames: ["CLAUDE.md"],
  ...Object.fromEntries(DISABLED_CODEX_FEATURES.map((feature) => [`features.${feature}`, false])),
};

/** The app-server's command line: settings as `-c` overrides only, and never a secret. */
export function codexAppServerArguments(): string[] {
  return [
    "app-server",
    ...Object.entries(CODEX_OVERRIDES).flatMap(([key, value]) => [
      "-c",
      `${key}=${tomlValue(value)}`,
    ]),
  ];
}

export function tomlValue(value: CodexConfigValue): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(", ")}]`;
  return String(value);
}

/**
 * Variables of Codex's and OpenAI's a session must not get: they would switch its account, its
 * folder or its API endpoint away from its engine's.
 */
const ENGINE_VARIABLE_PREFIXES = ["CODEX", "OPENAI"];

/**
 * The variables a session's app-server runs with: the given ones without Codex's and OpenAI's,
 * The Office's own, which hold its database credentials (spec §6), nor the container runtime's;
 * then `CODEX_HOME`, the engine's own folder. The Agent's commands inherit them, so the session's
 * MCP endpoint token is not among them (`codexMcpServers`).
 */
export function codexEnvironment(
  environment: Readonly<Record<string, string>>,
  codexHome: string,
): Record<string, string> {
  const given = Object.entries(withoutContainerRuntimeVariables(environment)).filter(
    ([name]) =>
      !isOfficeOwnVariable(name) &&
      !ENGINE_VARIABLE_PREFIXES.some((prefix) => name.toUpperCase().startsWith(prefix)),
  );
  return { ...Object.fromEntries(given), CODEX_HOME: codexHome };
}

/**
 * How long Codex waits on one call of a session's MCP server before failing it: long enough for an
 * Office tool that runs a Project's command, or a call held until someone decides (spec §6).
 */
const MCP_TOOL_TIMEOUT_SECONDS = 4 * 60 * 60;

/** How long Codex waits for the endpoint to answer MCP's initialization. */
const MCP_STARTUP_TIMEOUT_SECONDS = 30;

/** One server of `thread/start`'s `config.mcp_servers`, on the session's MCP endpoint. */
export interface CodexMcpServerConfig {
  readonly url: string;
  readonly http_headers: { readonly Authorization: string };
  readonly startup_timeout_sec: number;
  readonly tool_timeout_sec: number;
}

/**
 * The `mcp_servers` of `thread/start`'s `config`: each named server at its path of the session's
 * endpoint, behind its token as a header. The token goes only in this config, which reaches the
 * app-server on its input: never on its command line nor in the environment the Agent's commands
 * inherit (spec §5.4 Defaults). No Server value goes to Codex.
 */
export function codexMcpServers(
  endpoint: { readonly token: string; url(server: string): string },
  servers: readonly string[],
): Record<string, CodexMcpServerConfig> {
  return Object.fromEntries(
    servers.map((server) => [
      server,
      {
        url: endpoint.url(server),
        http_headers: { Authorization: `Bearer ${endpoint.token}` },
        startup_timeout_sec: MCP_STARTUP_TIMEOUT_SECONDS,
        tool_timeout_sec: MCP_TOOL_TIMEOUT_SECONDS,
      },
    ]),
  );
}

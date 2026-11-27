/**
 * Variables a session must not inherit: an API key would switch billing off the subscription,
 * `CLAUDE_CONFIG_DIR` and `CLAUDE_CODE_PLUGIN_DIRS` change what loads, and a parent Claude Code
 * session's own variables would make the child a nested session the Office never runs. The same
 * holds for Codex: `OPENAI_API_KEY` switches the account, and `CODEX_HOME` the account folder.
 */
const DROPPED_PREFIXES = ["CLAUDE", "ANTHROPIC", "OPENAI", "CODEX", "MCP_", "OTEL_"] as const;

/** Holds a Claude Code OAuth token (from `claude setup-token`); the strip above leaves it alone. */
export const CLAUDE_CODE_TOKEN_VARIABLE = "ENGINE_CHECK_CLAUDE_CODE_OAUTH_TOKEN";

/**
 * The environment of a Claude Code session on the account in `~/.claude`, or, when the check was
 * given a token, signed in with it as `CLAUDE_CODE_OAUTH_TOKEN`. The token is never logged or
 * recorded: the report holds messages and hook calls, not the environment.
 */
export function claudeCodeSessionEnvironment(
  parent: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const token = parent[CLAUDE_CODE_TOKEN_VARIABLE]?.trim();
  return {
    ...sessionEnvironment(parent),
    ...(token ? { CLAUDE_CODE_OAUTH_TOKEN: token } : {}),
  };
}

export function sessionEnvironment(
  parent: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(parent).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined &&
        !DROPPED_PREFIXES.some((prefix) => entry[0].toUpperCase().startsWith(prefix)),
    ),
  );
}

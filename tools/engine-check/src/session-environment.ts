/**
 * Variables a session must not inherit: an API key would switch billing off the subscription,
 * `CLAUDE_CONFIG_DIR` and `CLAUDE_CODE_PLUGIN_DIRS` change what loads, and a parent Claude Code
 * session's own variables would make the child a nested session the Office never runs.
 */
const DROPPED_PREFIXES = ["CLAUDE", "ANTHROPIC", "MCP_", "OTEL_"] as const;

export function sessionEnvironment(parent: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return Object.fromEntries(
    Object.entries(parent).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && !DROPPED_PREFIXES.some((prefix) => entry[0].toUpperCase().startsWith(prefix)),
    ),
  );
}

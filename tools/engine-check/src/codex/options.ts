import type { ConfigValue } from "./arguments.ts";
import type { ReasoningEffort } from "./protocol.ts";

/** The cheapest model `model/list` showed for a ChatGPT sign-in on the pinned Codex ("fast and affordable"). */
export const CODEX_CHECK_MODEL = "gpt-6-luna";
export const CODEX_CHECK_EFFORT: ReasoningEffort = "low";

/** The variable the app-server reads the Office tool server's bearer token from. */
export const OFFICE_TOOL_TOKEN_VARIABLE = "OFFICE_TOOL_TOKEN";

/**
 * The `-c` overrides every check's app-server starts with: the workspace-write sandbox kept to the
 * worktree (without the temp folders Codex adds by default), no update check, no web search, and the
 * folder's history and memories untouched by the check's threads.
 */
export const CODEX_OVERRIDES: Readonly<Record<string, ConfigValue>> = {
  "sandbox_workspace_write.exclude_slash_tmp": true,
  "sandbox_workspace_write.exclude_tmpdir_env_var": true,
  "sandbox_workspace_write.network_access": false,
  check_for_update_on_startup: false,
  web_search: "disabled",
  "history.persistence": "none",
};

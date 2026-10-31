/**
 * Which commands an Agent may run. Read-only git is allowed under each, and no profile allows a git
 * command that changes anything (spec §6).
 */
export type CommandPermission =
  | { readonly kind: "read-only-git" }
  /** The Project's own commands, as their command lines. */
  | { readonly kind: "project-commands"; readonly commandLines: readonly string[] }
  | { readonly kind: "anything" };

/**
 * What an Agent may do, as data from its Role card, narrowed by a Stage (spec §6). An Agent reads
 * its working folder and its skills folder under every profile.
 */
export interface PermissionProfile {
  /** Whether it edits files in its working folder. */
  readonly edit: boolean;
  readonly run: CommandPermission;
  /** Whether it searches and fetches the web. */
  readonly web: boolean;
  /**
   * The setting of each tool of the session's MCP servers, keyed `server/tool`: every one of them,
   * so a tool not here is not the session's.
   */
  readonly mcpTools: Readonly<Record<string, McpToolSetting>>;
}

/**
 * How an MCP tool's calls are seen to, set like a Hard switch on the Role card (spec §6): run, wait
 * on the approval of the person filling a Role (by its key) or of the user, or refused.
 */
export type McpToolSetting =
  | { readonly kind: "allowed" }
  | { readonly kind: "consult"; readonly role: string }
  | { readonly kind: "ask-me" }
  | { readonly kind: "never" };

/** A setting under which a call waits on someone's approval. */
export type ApprovalSetting = Extract<McpToolSetting, { readonly kind: "consult" | "ask-me" }>;

import type { RunPermission } from "./allowed-commands.js";

/** A Hard switch's value as the Role card keeps it, an MCP tool's too: Consult names a Role by its key. */
export type HardSwitchOnCard =
  | { readonly kind: "allowed" }
  | { readonly kind: "consult"; readonly role: string }
  | { readonly kind: "ask-me" }
  | { readonly kind: "never" };

/**
 * What an Agent Stage states of its Role card's permission profile, each absent where the card's
 * stands. It narrows the profile, never widens it (spec §6): editing and the web can only be taken
 * away, and a run permission or an MCP tool's setting wider than the card's leaves the card's.
 */
export interface StagePermissions {
  readonly edit?: false;
  readonly run?: RunPermission;
  readonly web?: false;
  /** Keyed `server/tool`; a tool the Role's MCP servers don't have is ignored. */
  readonly mcpTools?: Readonly<Record<string, HardSwitchOnCard>>;
  /**
   * The keys of the Project's commands the Stage keeps; absent keeps every one, as the card has no
   * list of its own. A key the Project lacks adds nothing, and install is never among them.
   */
  readonly commands?: string[];
}

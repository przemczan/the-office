import { consult, type HardSwitchValue } from "./hard-switches.js";
import { DEVOPS, KNOWN_ROLES } from "./known-roles.js";

/**
 * The settings of the tools of a Role's MCP servers, each set like a Hard switch (spec §6), keyed
 * by `mcpToolKey`. Only the tools the user set are kept; any other is at `MCP_TOOL_DEFAULT`.
 */
export type McpToolSettings = Readonly<Record<string, HardSwitchValue>>;

/** Where a tool starts, until the user sets it. */
export const MCP_TOOL_DEFAULT: HardSwitchValue = consult(DEVOPS);

/** An MCP server's name: no `/`, so the first one in a key ends it. */
const KEY_PATTERN = /^[a-z0-9-]+\/.+$/;

/** A tool's key in the settings: `server/tool`. */
export function mcpToolKey(serverName: string, toolName: string): string {
  return `${serverName}/${toolName}`;
}

export function mcpToolSetting(
  settings: McpToolSettings,
  serverName: string,
  toolName: string,
): HardSwitchValue {
  return settings[mcpToolKey(serverName, toolName)] ?? MCP_TOOL_DEFAULT;
}

/**
 * Each tool's setting by its key, for every tool of `servers`: the session's whole set, so a tool
 * the user never set holds at the default.
 */
export function mcpToolSettingsFor(
  settings: McpToolSettings,
  servers: readonly {
    readonly name: string;
    readonly tools: readonly { readonly name: string }[];
  }[],
): Record<string, HardSwitchValue> {
  return Object.fromEntries(
    servers.flatMap((server) =>
      server.tools.map((tool) => [
        mcpToolKey(server.name, tool.name),
        mcpToolSetting(settings, server.name, tool.name),
      ]),
    ),
  );
}

/**
 * Why a Role's MCP tool settings can't be saved, in the UI's words; empty when they can. Devops's
 * own card may keep the default: a consult its own person makes goes to the user.
 */
export function mcpToolSettingsProblems(roleKey: string, settings: McpToolSettings): string[] {
  const problems: string[] = [];
  for (const [key, value] of Object.entries(settings)) {
    if (!KEY_PATTERN.test(key)) {
      problems.push(`"${key}" doesn't name an MCP tool as server/tool.`);
    } else if (value.kind === "consult" && !KNOWN_ROLES.has(value.role)) {
      problems.push(`The MCP tool ${key} consults a Role The Office doesn't know.`);
    } else if (value.kind === "consult" && value.role === roleKey && roleKey !== DEVOPS) {
      problems.push(`The MCP tool ${key} can't consult the Role itself.`);
    }
  }
  return problems;
}

/** How much a setting lets through without anyone's say, from Never up. */
const BREADTH: Readonly<Record<HardSwitchValue["kind"], number>> = {
  never: 0,
  "ask-me": 1,
  consult: 2,
  allowed: 3,
};

/**
 * Whether `setting` lets through no more than `than`: Allowed, then Consult, then Ask me, then
 * Never. Consulting one Role is no narrower than consulting another, so neither is.
 */
export function noWiderThan(setting: HardSwitchValue, than: HardSwitchValue): boolean {
  if (setting.kind === "consult" && than.kind === "consult") return setting.role === than.role;
  return BREADTH[setting.kind] <= BREADTH[than.kind];
}

/**
 * A tool's setting under a Stage that sets it too (spec §6): the Stage's when it narrows the
 * card's, else the card's, since a Stage never widens it.
 */
export function narrowedMcpToolSetting(
  card: HardSwitchValue,
  stage: HardSwitchValue | undefined,
): HardSwitchValue {
  return stage !== undefined && noWiderThan(stage, card) ? stage : card;
}

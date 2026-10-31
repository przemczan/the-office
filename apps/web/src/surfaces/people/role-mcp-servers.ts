import type {
  HardSwitchValue,
  McpServer,
  McpServerTool,
  PermissionProfile,
} from "@the-office/contracts";
import { hardSwitchChoiceOf, mcpToolKey } from "../../shell/role-card-words.ts";

type McpToolSettings = PermissionProfile["mcpTools"];

/** The library's servers assigned to the Role, by name; none for a Role yet to be hired. */
export function assignedMcpServersOf(
  library: readonly McpServer[],
  roleKey: string | undefined,
): ReadonlySet<string> {
  if (roleKey === undefined) return new Set();
  return new Set(library.filter(({ roles }) => roles.includes(roleKey)).map(({ name }) => name));
}

/**
 * Each server whose Roles saving the card changes, with exactly the Roles it has then, as
 * `PUT /mcp-servers/:name/roles` takes them.
 */
export function mcpServerAssignments(
  library: readonly McpServer[],
  roleKey: string,
  assigned: ReadonlySet<string>,
): { readonly name: string; readonly roles: string[] }[] {
  return library.flatMap(({ name, roles }) => {
    const has = roles.includes(roleKey);
    if (has === assigned.has(name)) return [];
    return [{ name, roles: has ? roles.filter((key) => key !== roleKey) : [...roles, roleKey] }];
  });
}

/** The server's tools a session gets: those whose names aren't too long. */
export function sessionToolsOf(server: McpServer): McpServerTool[] {
  const tooLong = new Set(server.toolsTooLong);
  return server.tools.filter(({ name }) => !tooLong.has(name));
}

/** The tool's setting on the card: as the user set it, or the default. */
export function mcpToolSettingOf(
  settings: McpToolSettings,
  key: string,
  defaultSetting: HardSwitchValue,
): HardSwitchValue {
  return settings[key] ?? defaultSetting;
}

/** The settings with the tool's; the card keeps only what the user set, so the default is left out. */
export function withMcpToolSetting(
  settings: McpToolSettings,
  key: string,
  setting: HardSwitchValue,
  defaultSetting: HardSwitchValue,
): McpToolSettings {
  const { [key]: _replaced, ...others } = settings;
  return hardSwitchChoiceOf(setting) === hardSwitchChoiceOf(defaultSetting)
    ? others
    : { ...others, [key]: setting };
}

/** The settings without the server's tools', for a server taken off the card. */
export function withoutServerToolSettings(
  settings: McpToolSettings,
  serverName: string,
): McpToolSettings {
  const prefix = mcpToolKey(serverName, "");
  return Object.fromEntries(Object.entries(settings).filter(([key]) => !key.startsWith(prefix)));
}

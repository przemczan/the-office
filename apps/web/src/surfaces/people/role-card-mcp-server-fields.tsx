import { Link } from "@tanstack/react-router";
import type { HardSwitchValue, McpServer, PermissionProfile } from "@the-office/contracts";
import { Checkbox, Select } from "@the-office/ui";
import type { ReactNode } from "react";
import {
  hardSwitchChoiceOf,
  hardSwitchChoices,
  hardSwitchValueOf,
  mcpToolKey,
} from "../../shell/role-card-words.ts";
import { RoleCardGroup } from "./role-card-layout.tsx";
import { mcpToolSettingOf, sessionToolsOf, withMcpToolSetting } from "./role-mcp-servers.ts";

type McpToolSettings = PermissionProfile["mcpTools"];

interface McpServerFieldsProps {
  readonly library: readonly McpServer[];
  /** The servers ticked, by name; saving the card assigns exactly these. */
  readonly assigned: ReadonlySet<string>;
  readonly assign: (serverName: string, on: boolean) => void;
  readonly settings: McpToolSettings;
  readonly changeSettings: (settings: McpToolSettings) => void;
  /** The Roles an MCP tool may consult from this card. */
  readonly consultable: readonly { readonly key: string; readonly title: string }[];
  readonly defaultSetting: HardSwitchValue;
}

/**
 * The library's MCP servers to tick for the Role, and each tool of a ticked server that is on with
 * its setting, chosen as a Hard switch's (spec §6).
 */
export function McpServerFields(props: McpServerFieldsProps): ReactNode {
  if (props.library.length === 0) {
    return (
      <RoleCardGroup group="mcpServers">
        <p className="role-card-empty">
          The library has no MCP servers yet. Add one in{" "}
          <Link to="/settings/mcp-servers">Settings › MCP servers</Link>.
        </p>
      </RoleCardGroup>
    );
  }
  return (
    <RoleCardGroup group="mcpServers">
      {props.library.map((server) => (
        <McpServerPart key={server.name} server={server} {...props} />
      ))}
    </RoleCardGroup>
  );
}

function McpServerPart({
  server,
  assigned,
  assign,
  settings,
  changeSettings,
  consultable,
  defaultSetting,
}: McpServerFieldsProps & { readonly server: McpServer }): ReactNode {
  const ticked = assigned.has(server.name);
  const tools = sessionToolsOf(server);
  return (
    <div className="role-card-mcp-server" role="group" aria-label={`MCP server ${server.name}`}>
      <Checkbox
        checked={ticked}
        onChange={(on) => assign(server.name, on)}
        label={server.name}
        description={mcpServerNote(server)}
      />
      {ticked && tools.length > 0 && (
        <div className="role-card-mcp-tools">
          {tools.map((tool) => {
            const key = mcpToolKey(server.name, tool.name);
            return (
              <Select
                key={key}
                label={`MCP tool ${key}`}
                hint={tool.description || undefined}
                value={hardSwitchChoiceOf(mcpToolSettingOf(settings, key, defaultSetting))}
                options={hardSwitchChoices(consultable)}
                onChange={(choice) =>
                  changeSettings(
                    withMcpToolSetting(settings, key, hardSwitchValueOf(choice), defaultSetting),
                  )
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Whether a session gets the server, and how many tools it brings. */
function mcpServerNote(server: McpServer): string {
  if (server.state === "off") return "Off: no session gets it until it is on";
  const count = sessionToolsOf(server).length;
  const tools = `${count} ${count === 1 ? "tool" : "tools"}`;
  return server.toolsTooLong.length > 0
    ? `On, with ${tools}; sessions leave out ${server.toolsTooLong.join(", ")}: name too long`
    : `On, with ${tools}`;
}

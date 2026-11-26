import type { Role as RoleResponse } from "@the-office/contracts";
import type { Duties } from "../../application/duties.js";
import type { RoleService, RoleWithAssignments } from "../../application/role-service.js";
import { isBuiltIn } from "../../domain/caretaker.js";
import {
  authorityInEffect,
  hardSwitchesOf,
  presetAuthority,
  rowsAskingYouUntilHired,
} from "../../domain/authority.js";
import type { HardSwitchValue } from "../../domain/hard-switches.js";
import { mcpToolSetting } from "../../domain/mcp-tool-settings.js";

/** What a Role's answer reads besides the Role: who is hired, and where MCP tools start. */
export interface RoleResponseContext {
  /** The Roles someone fills: a person let go fills none. */
  readonly hiredRoles: ReadonlySet<string>;
  readonly mcpToolDefault: HardSwitchValue;
}

export async function roleResponseContext(
  roles: RoleService,
  duties: Duties,
  listed?: readonly RoleWithAssignments[],
): Promise<RoleResponseContext> {
  const [all, mcpToolDefault] = await Promise.all([
    listed ?? roles.list(),
    duties.mcpToolDefault(),
  ]);
  return {
    hiredRoles: new Set(all.filter(({ role }) => !role.letGoAt).map(({ role }) => role.key)),
    mcpToolDefault,
  };
}

export function toRoleResponse(
  { role, skills, mcpServers }: RoleWithAssignments,
  { hiredRoles, mcpToolDefault }: RoleResponseContext,
): RoleResponse {
  const { mcpTools } = role.card.permissionProfile;
  return {
    key: role.key,
    // The Hard switches go along for the release before Authority, which reads them.
    card: {
      ...role.card,
      hardSwitches: hardSwitchesOf(role.key, role.card.authority),
      skills: [...skills],
    },
    presetAuthority: presetAuthority(role.key),
    cardVersion: role.cardVersion,
    hiredAt: role.hiredAt.toISOString(),
    cardSavedAt: role.cardSavedAt.toISOString(),
    letGoAt: role.letGoAt?.toISOString() ?? null,
    avatar: role.avatar,
    builtIn: isBuiltIn(role.key),
    askingYouUntilHired: rowsAskingYouUntilHired(
      authorityInEffect(role.key, role.card.authority),
      hiredRoles,
    ),
    mcpServers: mcpServers.map((server) => ({
      name: server.name,
      on: server.on,
      tools: server.tools.map((tool) => ({
        name: tool,
        setting: mcpToolSetting(mcpTools, server.name, tool, mcpToolDefault),
      })),
    })),
  };
}

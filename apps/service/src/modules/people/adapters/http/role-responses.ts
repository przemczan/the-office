import type { Role as RoleResponse } from "@the-office/contracts";
import type { RoleWithAssignments } from "../../application/role-service.js";
import { isBuiltIn } from "../../domain/caretaker.js";
import { switchesAskingYouUntilHired } from "../../domain/hard-switches.js";
import { mcpToolSetting } from "../../domain/mcp-tool-settings.js";

/** The Roles someone fills: a person let go fills none. */
export function filledKeys(roles: readonly RoleWithAssignments[]): ReadonlySet<string> {
  return new Set(roles.filter(({ role }) => !role.letGoAt).map(({ role }) => role.key));
}

export function toRoleResponse(
  { role, skills, mcpServers }: RoleWithAssignments,
  hiredRoles: ReadonlySet<string>,
): RoleResponse {
  const { mcpTools } = role.card.permissionProfile;
  return {
    key: role.key,
    card: { ...role.card, skills: [...skills] },
    cardVersion: role.cardVersion,
    hiredAt: role.hiredAt.toISOString(),
    cardSavedAt: role.cardSavedAt.toISOString(),
    letGoAt: role.letGoAt?.toISOString() ?? null,
    avatar: role.avatar,
    builtIn: isBuiltIn(role.key),
    askingYouUntilHired: switchesAskingYouUntilHired(role.card.hardSwitches, hiredRoles),
    mcpServers: mcpServers.map((server) => ({
      name: server.name,
      on: server.on,
      tools: server.tools.map((tool) => ({
        name: tool,
        setting: mcpToolSetting(mcpTools, server.name, tool),
      })),
    })),
  };
}

import { Injectable, type OnModuleInit } from "@nestjs/common";
import { z } from "zod";
import { OfficeToolRegistry, type OfficeTool } from "../../../engine/index.js";
import { Duties } from "../../application/duties.js";
import { PersonRecords } from "../../application/person-records.js";
import { RoleService, type RoleWithAssignments } from "../../application/role-service.js";
import type { HardSwitchValue } from "../../domain/hard-switches.js";
import { mcpToolSetting, type McpToolSettings } from "../../domain/mcp-tool-settings.js";
import { RoleNotFound } from "../../domain/role-not-found.js";

export const LIST_PEOPLE = "list_people";
export const READ_ROLE = "read_role";

const READ_ROLE_INPUT = z.object({
  role: z.string().describe(`The Role's key, as ${LIST_PEOPLE} gives it, such as developer.`),
});

/** The Office tools that read the People's records (spec §6): never one that changes them. */
@Injectable()
export class PeopleOfficeTools implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly roles: RoleService,
    private readonly personRecords: PersonRecords,
    private readonly duties: Duties,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.listPeople());
    this.registry.register(this.readRole());
  }

  listPeople(): OfficeTool {
    return {
      name: LIST_PEOPLE,
      description: `Lists the people of The Office: each one's Role, responsibilities, capabilities, Task limit and the duties they hold, and the duties nobody holds with who stands in. ${READ_ROLE} gives a Role's whole card.`,
      input: z.object({}),
      run: async () => ({ text: await this.personRecords.everyone(), isError: false }),
    };
  }

  readRole(): OfficeTool<typeof READ_ROLE_INPUT> {
    return {
      name: READ_ROLE,
      description:
        "Reads a Role's whole card as it is now, which may be newer than what your session knows: its instructions in full and every other field, its Skills and its MCP servers. Read it before drafting a change to the Role, as a change gives each field whole.",
      input: READ_ROLE_INPUT,
      run: async ({ role }) => {
        try {
          const whole = wholeCard(
            await this.roles.read(role.trim()),
            await this.duties.mcpToolDefault(),
          );
          return { text: whole, isError: false };
        } catch (error) {
          if (error instanceof RoleNotFound) {
            return {
              text: `The Office has no Role "${role}". ${LIST_PEOPLE} gives the Roles' keys.`,
              isError: true,
            };
          }
          throw error;
        }
      },
    };
  }
}

/** Each field under the name `propose_role` takes it by, so a change can start from it whole. */
function wholeCard(
  { role, skills, mcpServers }: RoleWithAssignments,
  mcpToolDefault: HardSwitchValue,
): string {
  const { card } = role;
  return [
    `${card.name} · ${card.title} (Role ${role.key}), card version ${role.cardVersion}, saved ${role.cardSavedAt.toISOString()}.`,
    ...(role.letGoAt
      ? [
          `${card.name} was let go on ${role.letGoAt.toISOString()}: nobody fills the Role until the user hires them back.`,
        ]
      : []),
    `responsibilities: ${card.responsibilities}`,
    `instructions:\n${card.instructions}`,
    [
      `effort: ${card.effort}`,
      `Role override: ${card.roleOverride ? `${card.roleOverride.engineId}, ${card.roleOverride.model}` : "none, so the Office default"}`,
      `capabilities: ${JSON.stringify(card.capabilities)}`,
      `permissionProfile: ${JSON.stringify(card.permissionProfile)}`,
      `hardSwitches: ${JSON.stringify(card.hardSwitches)}`,
      `taskLimit: ${card.taskLimit}`,
      `sessionDefault: ${card.sessionDefault}`,
      `Skills: ${skills.length > 0 ? skills.join(", ") : "none besides the skills for everyone"}`,
      `MCP servers: ${mcpServers.length > 0 ? mcpServers.map((server) => mcpServerRecord(server, card.permissionProfile.mcpTools, mcpToolDefault)).join("; ") : "none"}`,
    ].join("\n"),
  ].join("\n\n");
}

function mcpServerRecord(
  server: RoleWithAssignments["mcpServers"][number],
  settings: McpToolSettings,
  mcpToolDefault: HardSwitchValue,
): string {
  const tools = server.tools.map(
    (tool) =>
      `${tool} ${settingInWords(mcpToolSetting(settings, server.name, tool, mcpToolDefault))}`,
  );
  return `${server.name} (${server.on ? "on" : "off"})${tools.length > 0 ? `: ${tools.join(", ")}` : ""}`;
}

function settingInWords(setting: HardSwitchValue): string {
  switch (setting.kind) {
    case "allowed":
      return "Allowed";
    case "consult":
      return `Consult ${setting.role}`;
    case "ask-me":
      return "Ask me";
    case "never":
      return "Never";
  }
}

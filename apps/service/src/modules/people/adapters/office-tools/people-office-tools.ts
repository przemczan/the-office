import { Injectable, type OnModuleInit } from "@nestjs/common";
import { z } from "zod";
import {
  ENGINE_TYPE_NAMES,
  OfficeToolRegistry,
  type EngineKind,
  type OfficeTool,
} from "../../../engine/index.js";
import { Duties } from "../../application/duties.js";
import { PersonRecords } from "../../application/person-records.js";
import { RoleService, type RoleWithAssignments } from "../../application/role-service.js";
import {
  AUTHORITY_AREAS,
  authorityInEffect,
  type Authority,
  type AuthorityGroup,
  type AuthoritySetting,
  type AuthorityValue,
} from "../../domain/authority.js";
import { isBuiltIn } from "../../domain/caretaker.js";
import type { HardSwitchValue } from "../../domain/hard-switches.js";
import { mcpToolSetting, type McpToolSettings } from "../../domain/mcp-tool-settings.js";
import type { PersonEngineSettings } from "../../domain/role-card.js";
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
      `engineSettings: ${engineSettingsInWords(card.engineSettings)}`,
      `capabilities: ${JSON.stringify(card.capabilities)}`,
      `permissionProfile: ${JSON.stringify(card.permissionProfile)}`,
      `authority: ${JSON.stringify(card.authority)}`,
      `taskLimit: ${card.taskLimit}`,
      `sessionDefault: ${card.sessionDefault}`,
      `Skills: ${skills.length > 0 ? skills.join(", ") : "none besides the skills for everyone"}`,
      `MCP servers: ${mcpServers.length > 0 ? mcpServers.map((server) => mcpServerRecord(server, card.permissionProfile.mcpTools, mcpToolDefault)).join("; ") : "none"}`,
    ].join("\n"),
    authorityInWords(role.key, card.authority),
  ].join("\n\n");
}

/**
 * Every Authority row in effect, by area, each saying whether the card sets it or it stands at the
 * preset's default; `authority` above gives the set rows, as a change takes them.
 */
function authorityInWords(roleKey: string, authority: Authority): string {
  const inEffect = authorityInEffect(roleKey, authority);
  const lines = AUTHORITY_AREAS.flatMap(({ label, rows }) =>
    rows.map(
      (row) =>
        `- ${label && label !== row.label ? `${label} › ` : ""}${row.label} (${row.group}): ${authoritySettingInWords(inEffect[row.group])}${standing(roleKey, authority, row.group)}`,
    ),
  );
  return [
    "Authority in effect (a row not in authority above stands at the preset's default):",
    ...lines,
  ].join("\n");
}

function standing(roleKey: string, authority: Authority, group: AuthorityGroup): string {
  if (isBuiltIn(roleKey)) return " (fixed)";
  return authority[group] !== undefined ? " (set)" : " (preset's default)";
}

function authoritySettingInWords(setting: AuthoritySetting): string {
  return setting.kind === "own-and-others"
    ? `${authorityValueInWords(setting.own)} on own · ${authorityValueInWords(setting.others)} on others'`
    : authorityValueInWords(setting);
}

function authorityValueInWords(value: AuthorityValue): string {
  return value.kind === "proposal" ? "Proposal" : settingInWords(value);
}

const ENGINE_DEFAULT = "Engine's default";

/** The person's model and effort on each engine type they set one for, by the type's name. */
function engineSettingsInWords(settings: PersonEngineSettings): string {
  const types = (Object.keys(ENGINE_TYPE_NAMES) as EngineKind[]).flatMap((type) => {
    const setting = settings[type];
    return setting === undefined
      ? []
      : [
          `${ENGINE_TYPE_NAMES[type]}: ${setting.model ?? ENGINE_DEFAULT} · ${setting.effort ?? ENGINE_DEFAULT}`,
        ];
  });
  return types.length > 0
    ? types.join("; ")
    : "none set, so each engine's default model and effort";
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

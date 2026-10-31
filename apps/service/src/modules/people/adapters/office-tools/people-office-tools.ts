import { Injectable, type OnModuleInit } from "@nestjs/common";
import { z } from "zod";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { RoleService, type RoleWithAssignments } from "../../application/role-service.js";
import { KNOWN_ROLES } from "../../domain/known-roles.js";

/** An Office tool as the registry takes it. */
type OfficeTool = Parameters<OfficeToolRegistry["register"]>[0];

export const LIST_PEOPLE = "list_people";

/** The Office tools that read the People's records (spec §6): never one that changes them. */
@Injectable()
export class PeopleOfficeTools implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly roles: RoleService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.listPeople());
  }

  listPeople(): OfficeTool {
    return {
      name: LIST_PEOPLE,
      description:
        "Lists the people of The Office: each one's Role, responsibilities, capabilities and Task limit, and the Roles nobody fills yet.",
      input: z.object({}),
      run: async () => {
        const roles = await this.roles.list();
        const hired = new Set(roles.map(({ role }) => role.key));
        const unfilled = [...KNOWN_ROLES]
          .filter(([key]) => !hired.has(key))
          .map(([, title]) => title);
        const lines = [
          ...(roles.length > 0 ? roles.map(personRecord) : ["Nobody is hired yet."]),
          ...(unfilled.length > 0
            ? [
                `Nobody fills ${unfilled.join(", ")} yet: whoever would consult one of them asks the user.`,
              ]
            : []),
        ];
        return { text: lines.join("\n\n"), isError: false };
      },
    };
  }
}

function personRecord({ role, skills }: RoleWithAssignments): string {
  const { card } = role;
  const capabilities = [
    card.capabilities.chat ? "Chat on" : "Chat off",
    card.capabilities.consultant ? "Consultant" : "not a Consultant",
  ].join(", ");
  const limit =
    card.taskLimit === "none"
      ? "talks only, never works a Stage"
      : `up to ${card.taskLimit} Tasks at once`;
  return [
    `${card.name} · ${card.title} (Role ${role.key})`,
    card.responsibilities,
    `${capabilities}; ${limit}.${skills.length > 0 ? ` Skills: ${skills.join(", ")}.` : ""}`,
  ].join("\n");
}

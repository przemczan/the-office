import { Injectable } from "@nestjs/common";
import { KNOWN_ROLES } from "../domain/known-roles.js";
import { RoleNotFound } from "../domain/role-not-found.js";
import { RoleService, type RoleWithAssignments } from "./role-service.js";

/**
 * The people's short records as an Agent reads them: `list_people` gives them all, and a chat
 * message sent beside a person's page gives theirs (spec §2.4).
 */
@Injectable()
export class PersonRecords {
  constructor(private readonly roles: RoleService) {}

  /** Everyone hired, then the Roles nobody fills yet. */
  async everyone(): Promise<string> {
    const roles = await this.roles.list();
    const hired = new Set(roles.map(({ role }) => role.key));
    const unfilled = [...KNOWN_ROLES].filter(([key]) => !hired.has(key)).map(([, title]) => title);
    return [
      ...(roles.length > 0 ? roles.map(personRecord) : ["Nobody is hired yet."]),
      ...(unfilled.length > 0
        ? [
            `Nobody fills ${unfilled.join(", ")} yet: whoever would consult one of them asks the user.`,
          ]
        : []),
    ].join("\n\n");
  }

  /** The person filling the Role; undefined when The Office has no such Role. */
  async of(roleKey: string): Promise<string | undefined> {
    try {
      const role = await this.roles.read(roleKey);
      const record = personRecord(role);
      const { letGoAt } = role.role;
      return letGoAt ? `${record}\nLet go on ${letGoAt.toISOString()}.` : record;
    } catch (error) {
      if (error instanceof RoleNotFound) return undefined;
      throw error;
    }
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

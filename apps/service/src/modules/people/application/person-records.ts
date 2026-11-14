import { Injectable } from "@nestjs/common";
import type { DutyFallback } from "../domain/duties.js";
import { RoleNotFound } from "../domain/role-not-found.js";
import { Duties, type DutyWithHolder } from "./duties.js";
import { RoleService, type RoleWithAssignments } from "./role-service.js";

/** What happens while nobody holds a duty, as a record says it. */
const FALLBACK_WORDS: Readonly<Record<DutyFallback, string>> = {
  user: "it falls to the user",
  caretaker: "the Caretaker stands in",
  unstaffed: "the Pipelines naming it can't start",
};

/**
 * The people's short records as an Agent reads them: `list_people` gives them all, and a chat
 * message sent beside a person's page gives theirs (spec §2.4).
 */
@Injectable()
export class PersonRecords {
  constructor(
    private readonly roles: RoleService,
    private readonly duties: Duties,
  ) {}

  /** Everyone hired, each with the duties they hold, then the duties nobody holds. */
  async everyone(): Promise<string> {
    const roles = await this.roles.list();
    const duties = await this.duties.list();
    const unheld = duties.filter((duty): duty is UnheldDuty => duty.fallback !== null);
    return [
      ...(roles.length > 0
        ? roles.map((role) => personRecord(role, duties))
        : ["Nobody is hired yet."]),
      ...(unheld.length > 0 ? [unheld.map(unheldDutyLine).join("\n")] : []),
    ].join("\n\n");
  }

  /** The person filling the Role; undefined when The Office has no such Role. */
  async of(roleKey: string): Promise<string | undefined> {
    try {
      const role = await this.roles.read(roleKey);
      const record = personRecord(role, await this.duties.list());
      const { letGoAt } = role.role;
      return letGoAt ? `${record}\nLet go on ${letGoAt.toISOString()}.` : record;
    } catch (error) {
      if (error instanceof RoleNotFound) return undefined;
      throw error;
    }
  }
}

/** A duty nobody holds, so its fallback applies. */
type UnheldDuty = DutyWithHolder & { readonly fallback: DutyFallback };

function unheldDutyLine({ label, fallback }: UnheldDuty): string {
  return `Nobody holds ${label}: ${FALLBACK_WORDS[fallback]}.`;
}

function personRecord(
  { role, skills }: RoleWithAssignments,
  duties: readonly DutyWithHolder[],
): string {
  const held = duties.filter((duty) => duty.holder?.roleKey === role.key);
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
    ...(held.length > 0 ? [`Holds: ${held.map((duty) => duty.label).join(", ")}.`] : []),
  ].join("\n");
}

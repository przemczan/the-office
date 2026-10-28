import { Injectable } from "@nestjs/common";
import type { Stage } from "../domain/stage.js";
import type { RoleFilling } from "../domain/stage-staffing.js";
import { KnownPeople } from "../ports/known-people.js";

/** Who fills each Role that Agent Stages name, for the Stage editor's checks, on a Task or in the library. */
@Injectable()
export class RoleFillings {
  constructor(private readonly people: KnownPeople) {}

  async of(stages: readonly Stage[]): Promise<ReadonlyMap<string, RoleFilling>> {
    const roleKeys = new Set(
      stages.flatMap((stage) => (stage.kind === "agent" ? [stage.role] : [])),
    );
    const fillings = await Promise.all(
      [...roleKeys].map(async (roleKey): Promise<[string, RoleFilling]> => {
        const person = await this.people.find(roleKey);
        const letGo = person ? undefined : await this.people.findLetGo(roleKey);
        return [
          roleKey,
          {
            title: this.people.roleTitle(roleKey),
            person: person && { name: person.card.name, taskLimit: person.card.taskLimit },
            letGoPerson: letGo?.name,
          },
        ];
      }),
    );
    return new Map(fillings);
  }
}

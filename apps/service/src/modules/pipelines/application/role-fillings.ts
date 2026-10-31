import { Injectable } from "@nestjs/common";
import { permissionNarrowingProblems } from "../../people/index.js";
import { problemOnStage, type StageProblem } from "../domain/pipeline.js";
import type { Stage } from "../domain/stage.js";
import type { RoleFilling } from "../domain/stage-staffing.js";
import { KnownPeople } from "../ports/known-people.js";

/**
 * Who fills each Role that Agent Stages name and what their card allows, for the Stage editor's
 * checks, on a Task or in the library.
 */
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

  /**
   * Agent Stages from `fromIndex` on whose permissions would widen their Role card's profile, which
   * a Stage never does (spec §6), so the card's would apply. A Role nobody fills is left to
   * `of`'s flags; Stages before `fromIndex` have started and keep what they ran with.
   */
  async permissionProblems(stages: readonly Stage[], fromIndex: number): Promise<StageProblem[]> {
    const problems = await Promise.all(
      stages.map(async (stage, stageIndex) => {
        if (stageIndex < fromIndex || stage.kind !== "agent" || !stage.permissions) return [];
        const person = await this.people.find(stage.role);
        if (!person) return [];
        return permissionNarrowingProblems(
          stage.role,
          person.card.permissionProfile,
          stage.permissions,
        ).map((problem) => problemOnStage(stage, stageIndex, problem));
      }),
    );
    return problems.flat();
  }
}

import { Injectable } from "@nestjs/common";
import type { DutyKey } from "../../people/index.js";
import { problemOnStage, type StageProblem } from "../domain/pipeline.js";
import { agentStageWorkers, stageWorker, type Stage } from "../domain/stage.js";
import type { StageRun } from "../domain/stage-run.js";
import {
  dutiesToStaff,
  dutyLabel,
  fillingKey,
  staffedStages,
  type RoleFilling,
  type RoleFillingsByWorker,
} from "../domain/stage-staffing.js";
import { KnownPeople } from "../ports/known-people.js";

/**
 * Who fills each Role and holds each duty that Agent Stages name, and what their card allows, for
 * the Stage editor's checks, on a Task or in the library. A duty is weighed by its holder as it
 * stands now, the Role it names but who was let go, or nobody.
 */
@Injectable()
export class RoleFillings {
  constructor(private readonly people: KnownPeople) {}

  async of(stages: readonly Stage[]): Promise<RoleFillingsByWorker> {
    const { roles, duties } = agentStageWorkers(stages);
    const fillings = await Promise.all([
      ...[...roles].map(async (roleKey) => [roleKey, await this.roleFilling(roleKey)] as const),
      ...[...duties].map(
        async (duty) => [fillingKey({ duty }), await this.dutyFilling(duty)] as const,
      ),
    ]);
    return new Map(fillings);
  }

  /** `stages` with each Stage naming a duty given who works it, as it would start now. */
  async staffed(stages: readonly Stage[], runs: readonly StageRun[]): Promise<Stage[]> {
    return staffedStages(stages, runs, await this.holders(stages));
  }

  /** The holders of the duties `stages` name, those nobody holds left out. */
  async holders(stages: readonly Stage[]): Promise<ReadonlyMap<DutyKey, string>> {
    const held = await Promise.all(
      dutiesToStaff(stages).map(async (duty) => [duty, await this.people.holderOf(duty)] as const),
    );
    return new Map(
      held.flatMap(([duty, holder]) => (holder === undefined ? [] : [[duty, holder] as const])),
    );
  }

  /**
   * Agent Stages whose permissions would widen their Role card's profile, which a Stage never does
   * (spec §6), so the card's would apply. A Role nobody fills is left to `of`'s flags; Stages whose
   * keys are in `skipped` have started and keep what they ran with.
   */
  async permissionProblems(
    stages: readonly Stage[],
    skipped: ReadonlySet<string>,
  ): Promise<StageProblem[]> {
    const problems = await Promise.all(
      stages.map(async (stage, stageIndex) =>
        skipped.has(stage.key)
          ? []
          : (await this.stagePermissionProblems(stage)).map((problem) =>
              problemOnStage(stage, stageIndex, problem),
            ),
      ),
    );
    return problems.flat();
  }

  /**
   * `permissionProblems` of one Stage, worded without saying which Stage it is; a Stage naming a
   * duty is weighed against its holder's card.
   */
  async stagePermissionProblems(stage: Stage): Promise<string[]> {
    if (stage.kind !== "agent" || !stage.permissions) return [];
    const worker = stageWorker(stage);
    if (!worker) return [];
    const roleKey = "role" in worker ? worker.role : await this.people.holderOf(worker.duty);
    if (roleKey === undefined) return [];
    return this.people.permissionNarrowingProblems(roleKey, stage.permissions);
  }

  private async roleFilling(roleKey: string): Promise<RoleFilling> {
    const person = await this.people.find(roleKey);
    const letGo = person ? undefined : await this.people.findLetGo(roleKey);
    return {
      title: this.people.roleTitle(roleKey),
      person: person && { name: person.card.name, taskLimit: person.card.taskLimit },
      letGoPerson: letGo?.name,
    };
  }

  private async dutyFilling(duty: DutyKey): Promise<RoleFilling> {
    const label = dutyLabel(duty);
    const roleKey = (await this.people.holderOf(duty)) ?? (await this.people.dutyRoleKey(duty));
    if (roleKey === undefined) return { title: label, person: undefined, duty: { label } };
    return { ...(await this.roleFilling(roleKey)), duty: { label } };
  }
}

import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import {
  assignedSkillsProblems,
  assignmentsChange,
  rolesOfSkill,
  skillsOfRole,
  withRoleSkills,
  withSkillRoles,
  type AssignmentsChange,
  type RoleSkillAssignment,
  type RoleSkillsChange as AssignedSkillsChange,
} from "../domain/role-skills.js";
import { RoleSkillsChanged } from "../domain/skill-events.js";
import { SkillNotFound } from "../domain/skill-not-found.js";
import { SkillRefused } from "../domain/skill-refused.js";
import type { UserRef } from "../domain/user.js";
import { RoleSkillRepository } from "../ports/role-skill-repository.js";
import { SkillRepository } from "../ports/skill-repository.js";

/** What one Role gained and lost in one change of its skills. */
export type RoleSkillsChange = AssignedSkillsChange;

/**
 * Which library skills each Role has (spec §2.6), from its Role card or from Settings › Skills.
 * A change reaches the Role's next sessions; running ones keep the skills they started with.
 */
@Injectable()
export class RoleSkills {
  constructor(
    private readonly repository: RoleSkillRepository,
    private readonly skills: SkillRepository,
    private readonly events: EventBus,
  ) {}

  /** The skills the Role has besides the skills for everyone, in name order. */
  async of(roleKey: string): Promise<string[]> {
    return skillsOfRole(await this.repository.list(), roleKey);
  }

  /** Each Role's skills, by the Role's key. */
  async byRole(): Promise<ReadonlyMap<string, readonly string[]>> {
    return groupedBy(await this.repository.list(), "roleKey", "skillName");
  }

  /** The Roles each skill is assigned to, by the skill's name. */
  async bySkill(): Promise<ReadonlyMap<string, readonly string[]>> {
    return groupedBy(await this.repository.list(), "skillName", "roleKey");
  }

  /** Why the skills can't be assigned, so a Role card can refuse with every reason at once. */
  async problemsWith(skillNames: readonly string[]): Promise<string[]> {
    return assignedSkillsProblems(skillNames, await this.skills.list());
  }

  /**
   * Gives the Role exactly these skills, as the user `changedBy` did, or nobody named; refuses with
   * every reason for one the library lacks.
   */
  async assignToRole(
    roleKey: string,
    skillNames: readonly string[],
    changedBy: UserRef | null,
  ): Promise<string[]> {
    const problems = await this.problemsWith(skillNames);
    if (problems.length > 0) throw new SkillRefused(problems);
    const { assignments } = await this.update(
      (current) => withRoleSkills(current, roleKey, skillNames),
      changedBy,
    );
    return skillsOfRole(assignments, roleKey);
  }

  /** Gives the skill to exactly these Roles, as the user `changedBy` did. */
  async assignSkill(
    skillName: string,
    roleKeys: readonly string[],
    changedBy: UserRef,
  ): Promise<string[]> {
    if (!(await this.skills.find(skillName))) throw new SkillNotFound(skillName);
    const { assignments } = await this.update(
      (current) => withSkillRoles(current, skillName, roleKeys),
      changedBy,
    );
    return rolesOfSkill(assignments, skillName);
  }

  /** The Role's changes, newest first, for its change history. */
  async changes(roleKey: string): Promise<readonly RoleSkillsChange[]> {
    return this.repository.changes(roleKey);
  }

  private async update(
    next: (current: readonly RoleSkillAssignment[]) => readonly RoleSkillAssignment[],
    changedBy: UserRef | null,
  ): Promise<AssignmentsChange> {
    const changedAt = new Date();
    const changed = await this.repository.update((current) =>
      assignmentsChange(current, next(current), changedAt, changedBy),
    );
    for (const change of changed.changes) await this.events.publish(new RoleSkillsChanged(change));
    return changed;
  }
}

function groupedBy(
  assignments: readonly RoleSkillAssignment[],
  key: keyof RoleSkillAssignment,
  value: keyof RoleSkillAssignment,
): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const assignment of assignments) {
    grouped.set(assignment[key], [...(grouped.get(assignment[key]) ?? []), assignment[value]]);
  }
  for (const values of grouped.values()) values.sort();
  return grouped;
}

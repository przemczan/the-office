import type { Skill } from "./skill.js";

/**
 * A library skill assigned to a Role, by the key People keeps the Role by. Skills takes the key as
 * given: People finds the Role before it assigns, and Settings › Skills offers only hired Roles.
 */
export interface RoleSkillAssignment {
  readonly roleKey: string;
  readonly skillName: string;
}

/** What one Role gained and lost in one change of assignments, each in name order. */
export interface RoleSkillsChange {
  readonly roleKey: string;
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changedAt: Date;
}

/** The assignments after a change, with what each Role gained and lost; changes in key order. */
export interface AssignmentsChange {
  readonly assignments: readonly RoleSkillAssignment[];
  readonly changes: readonly RoleSkillsChange[];
}

/** The assignments with the Role's skills replaced by `skillNames`. */
export function withRoleSkills(
  assignments: readonly RoleSkillAssignment[],
  roleKey: string,
  skillNames: readonly string[],
): RoleSkillAssignment[] {
  return [
    ...assignments.filter((assignment) => assignment.roleKey !== roleKey),
    ...[...new Set(skillNames)].map((skillName) => ({ roleKey, skillName })),
  ];
}

/** The assignments with the Roles that have the skill replaced by `roleKeys`. */
export function withSkillRoles(
  assignments: readonly RoleSkillAssignment[],
  skillName: string,
  roleKeys: readonly string[],
): RoleSkillAssignment[] {
  return [
    ...assignments.filter((assignment) => assignment.skillName !== skillName),
    ...[...new Set(roleKeys)].map((roleKey) => ({ roleKey, skillName })),
  ];
}

/** From `before` to `after`, at `changedAt`; no change for a Role whose skills stay the same. */
export function assignmentsChange(
  before: readonly RoleSkillAssignment[],
  after: readonly RoleSkillAssignment[],
  changedAt: Date,
): AssignmentsChange {
  const was = skillsByRole(before);
  const is = skillsByRole(after);
  const roleKeys = [...new Set([...was.keys(), ...is.keys()])].toSorted();
  const changes = roleKeys.flatMap((roleKey) => {
    const from = was.get(roleKey) ?? new Set<string>();
    const to = is.get(roleKey) ?? new Set<string>();
    const added = [...to].filter((name) => !from.has(name)).toSorted();
    const removed = [...from].filter((name) => !to.has(name)).toSorted();
    return added.length + removed.length === 0 ? [] : [{ roleKey, added, removed, changedAt }];
  });
  return { assignments: after, changes };
}

/** The Role's skills, in name order. */
export function skillsOfRole(
  assignments: readonly RoleSkillAssignment[],
  roleKey: string,
): string[] {
  return assignments
    .filter((assignment) => assignment.roleKey === roleKey)
    .map((assignment) => assignment.skillName)
    .toSorted();
}

/** The Roles that have the skill, in key order. */
export function rolesOfSkill(
  assignments: readonly RoleSkillAssignment[],
  skillName: string,
): string[] {
  return assignments
    .filter((assignment) => assignment.skillName === skillName)
    .map((assignment) => assignment.roleKey)
    .toSorted();
}

/** Why the skills can't be assigned, in the UI's words; empty when they can. */
export function assignedSkillsProblems(
  skillNames: readonly string[],
  library: readonly Skill[],
): string[] {
  const names = new Set(library.map((skill) => skill.name));
  return [...new Set(skillNames)]
    .filter((name) => !names.has(name))
    .map((name) => `The library has no skill ${name}.`);
}

function skillsByRole(assignments: readonly RoleSkillAssignment[]): Map<string, Set<string>> {
  const byRole = new Map<string, Set<string>>();
  for (const { roleKey, skillName } of assignments) {
    byRole.set(roleKey, (byRole.get(roleKey) ?? new Set()).add(skillName));
  }
  return byRole;
}

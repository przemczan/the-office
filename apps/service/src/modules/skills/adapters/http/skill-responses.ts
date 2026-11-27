import type { Skill as SkillResponse } from "@the-office/contracts";
import type { RoleSkills } from "../../application/role-skills.js";
import type { SkillUses } from "../../application/skill-uses.js";
import type { Skill } from "../../domain/skill.js";

/** The skill as the API shows it: with its Roles (`assigned` when already known) and its uses. */
export async function skillResponseOf(
  skill: Skill,
  roleSkills: RoleSkills,
  uses: SkillUses,
  assigned?: readonly string[],
): Promise<SkillResponse> {
  const [roles, counts] = await Promise.all([
    assigned ?? roleSkills.bySkill().then((bySkill) => bySkill.get(skill.name) ?? []),
    uses.libraryCounts(),
  ]);
  return toSkillResponse(skill, roles, counts.get(skill.name) ?? 0);
}

/** A skill as the API shows it, with the Roles it is assigned to and its Skill uses. */
export function toSkillResponse(
  skill: Skill,
  roles: readonly string[],
  usesInLast7Days: number,
): SkillResponse {
  return {
    name: skill.name,
    description: skill.description,
    source: skill.source,
    ...(skill.installedFrom && { installedFrom: skill.installedFrom }),
    ...(skill.update && { update: skill.update }),
    version: skill.version,
    filesHash: skill.filesHash,
    state: skill.state,
    everyone: skill.everyone,
    roles: [...roles],
    addedAt: skill.addedAt.toISOString(),
    savedAt: skill.savedAt.toISOString(),
    usesInLast7Days,
  };
}

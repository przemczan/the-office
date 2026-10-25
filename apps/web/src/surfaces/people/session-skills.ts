import type { Role, Skill } from "@the-office/contracts";

/**
 * The library skills the person's next session gets: those that are on, for everyone or assigned to
 * the Role. One that is off never reaches a session, so People doesn't show it as theirs.
 */
export function sessionSkillsOf(role: Role, library: readonly Skill[]): Skill[] {
  return library.filter(
    (skill) => skill.state === "on" && (skill.everyone || role.card.skills.includes(skill.name)),
  );
}

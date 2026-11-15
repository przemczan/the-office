import { Injectable } from "@nestjs/common";
import { skillsOfRole } from "../domain/role-skills.js";
import { librarySkillsFor, type SessionSkill } from "../domain/session-skills.js";
import type { Skill } from "../domain/skill.js";
import { RoleSkillRepository } from "../ports/role-skill-repository.js";
import { SessionSkillRepository } from "../ports/session-skill-repository.js";
import { SkillRepository } from "../ports/skill-repository.js";

/** A library skill the user may run in a session by typing "/<name>" (spec §2.4). */
export interface SkillCommand {
  readonly name: string;
  readonly description: string;
}

/**
 * The skill commands a Thread offers (spec §2.4): the library skills of the session that takes
 * its next message, never a Project skill. The contracts leave out one whose name an Office
 * command takes, as the HTTP adapter maps them.
 */
@Injectable()
export class SkillCommands {
  constructor(
    private readonly skills: SkillRepository,
    private readonly records: SessionSkillRepository,
    private readonly roleSkills: RoleSkillRepository,
  ) {}

  /** For a session that goes on: the library skills it recorded; none for one with no record. */
  async ofSession(sessionId: string): Promise<SkillCommand[]> {
    const record = await this.records.find(sessionId);
    if (record === undefined) return [];
    return commandsOf(record.skills, await this.skills.list());
  }

  /** For a new session of the Role: what `SessionSkills.prepare` would give it from the library. */
  async forRole(roleKey: string): Promise<SkillCommand[]> {
    const [library, assignments] = await Promise.all([this.skills.list(), this.roleSkills.list()]);
    return commandsOf(librarySkillsFor(library, skillsOfRole(assignments, roleKey)), library);
  }
}

/** Each skill as a command, described as the library describes it now, in name order. */
function commandsOf(
  sessionSkills: readonly SessionSkill[],
  library: readonly Skill[],
): SkillCommand[] {
  const descriptions = new Map(library.map((skill) => [skill.name, skill.description]));
  return sessionSkills
    .map((skill) => ({ name: skill.name, description: descriptions.get(skill.name) ?? "" }))
    .toSorted((first, second) => (first.name < second.name ? -1 : 1));
}

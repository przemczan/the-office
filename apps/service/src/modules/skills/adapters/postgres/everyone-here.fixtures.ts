import type { ProviderOverride } from "../../../../../test/test-application.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { Skill } from "../../domain/skill.js";
import { SkillRepository } from "../../ports/skill-repository.js";
import { PostgresSkillRepository } from "./postgres-skill-repository.js";

/**
 * The stored skills, with the test's own also for everyone, in this app alone: a skill on and
 * for everyone in the shared database would reach every session another test file prepares,
 * whose folder lacks its files (apps/service/docs/testing.md).
 */
export class EveryoneHereSkillRepository extends PostgresSkillRepository {
  constructor(
    database: Database,
    private readonly namesForEveryone: () => ReadonlySet<string>,
  ) {
    super(database);
  }

  override async find(name: string): Promise<Skill | undefined> {
    const skill = await super.find(name);
    return skill && this.asHere(skill);
  }

  override async list(): Promise<readonly Skill[]> {
    return (await super.list()).map((skill) => this.asHere(skill));
  }

  private asHere(skill: Skill): Skill {
    return this.namesForEveryone().has(skill.name) ? { ...skill, everyone: true } : skill;
  }
}

/** The skills as the test sees them: those `everyoneHere` names are for everyone. */
export function everyoneHere(names: () => ReadonlySet<string>): ProviderOverride {
  return {
    provide: SkillRepository,
    useFactory: (database: Database) => new EveryoneHereSkillRepository(database, names),
    inject: [DATABASE],
  };
}

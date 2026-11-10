import { Inject, Injectable } from "@nestjs/common";
import { and, count, eq, gt, isNotNull, lte } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { SkillUse } from "../../domain/skill-uses.js";
import { SkillUseRepository } from "../../ports/skill-use-repository.js";
import { skills, skillUses } from "./skills.schema.js";

@Injectable()
export class PostgresSkillUseRepository extends SkillUseRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async add({ sessionId, skill, usedAt }: SkillUse): Promise<boolean> {
    if (skill.kind === "project") {
      await this.database.insert(skillUses).values({
        usedAt,
        sessionId,
        projectId: skill.projectId,
        projectSkillKey: skill.key,
      });
      return true;
    }
    return this.database.transaction(async (transaction) => {
      // Only while the library lists the skill, held so it isn't removed meanwhile.
      const [listed] = await transaction
        .select({ name: skills.name })
        .from(skills)
        .where(eq(skills.name, skill.skillName))
        .for("key share");
      if (listed === undefined) return false;
      await transaction.insert(skillUses).values({ usedAt, sessionId, skillName: listed.name });
      return true;
    });
  }

  async libraryCounts(since: Date): Promise<ReadonlyMap<string, number>> {
    const rows = await this.database
      .select({ skillName: skillUses.skillName, uses: count() })
      .from(skillUses)
      .where(and(isNotNull(skillUses.skillName), gt(skillUses.usedAt, since)))
      .groupBy(skillUses.skillName);
    return new Map(rows.flatMap(({ skillName, uses }) => (skillName ? [[skillName, uses]] : [])));
  }

  async projectCounts(projectId: string, since: Date): Promise<ReadonlyMap<string, number>> {
    const rows = await this.database
      .select({ key: skillUses.projectSkillKey, uses: count() })
      .from(skillUses)
      .where(and(eq(skillUses.projectId, projectId), gt(skillUses.usedAt, since)))
      .groupBy(skillUses.projectSkillKey);
    return new Map(rows.flatMap(({ key, uses }) => (key ? [[key, uses]] : [])));
  }

  async removeUntil(until: Date): Promise<void> {
    await this.database.delete(skillUses).where(lte(skillUses.usedAt, until));
  }
}

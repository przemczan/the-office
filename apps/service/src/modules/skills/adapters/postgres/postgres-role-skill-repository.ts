import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type {
  AssignmentsChange,
  RoleSkillAssignment,
  RoleSkillsChange,
} from "../../domain/role-skills.js";
import { RoleSkillRepository } from "../../ports/role-skill-repository.js";
import { roleSkillChanges, roleSkills } from "./skills.schema.js";

@Injectable()
export class PostgresRoleSkillRepository extends RoleSkillRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async list(): Promise<readonly RoleSkillAssignment[]> {
    return this.database.select().from(roleSkills);
  }

  async update(
    change: (assignments: readonly RoleSkillAssignment[]) => AssignmentsChange,
  ): Promise<AssignmentsChange> {
    return this.database.transaction(async (transaction) => {
      // A change reads every assignment, so it holds them all; reads go on meanwhile.
      await transaction.execute(sql`lock table ${roleSkills} in exclusive mode`);
      const changed = change(await transaction.select().from(roleSkills));
      for (const { roleKey, added, removed, changedAt, changedBy } of changed.changes) {
        if (removed.length > 0) {
          await transaction
            .delete(roleSkills)
            .where(
              and(eq(roleSkills.roleKey, roleKey), inArray(roleSkills.skillName, [...removed])),
            );
        }
        if (added.length > 0) {
          await transaction
            .insert(roleSkills)
            .values(added.map((skillName) => ({ roleKey, skillName })));
        }
        await transaction
          .insert(roleSkillChanges)
          .values({ roleKey, added: [...added], removed: [...removed], changedAt, changedBy });
      }
      return changed;
    });
  }

  async changes(roleKey: string): Promise<readonly RoleSkillsChange[]> {
    return this.database
      .select({
        roleKey: roleSkillChanges.roleKey,
        added: roleSkillChanges.added,
        removed: roleSkillChanges.removed,
        changedAt: roleSkillChanges.changedAt,
        changedBy: roleSkillChanges.changedBy,
      })
      .from(roleSkillChanges)
      .where(eq(roleSkillChanges.roleKey, roleKey))
      .orderBy(desc(roleSkillChanges.changedAt), desc(roleSkillChanges.id));
  }
}

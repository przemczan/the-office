import { Inject, Injectable } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import type { InstalledSource } from "../../domain/installed-source.js";
import { skillNameTaken, type Skill } from "../../domain/skill.js";
import type { SkillChange } from "../../domain/skill-changes.js";
import { SkillNotFound } from "../../domain/skill-not-found.js";
import { SkillRefused } from "../../domain/skill-refused.js";
import { currentVersionOf, type SkillVersion } from "../../domain/skill-version.js";
import { SkillRepository, type SkillUpdate } from "../../ports/skill-repository.js";
import { skills, skillVersions } from "./skills.schema.js";

type SkillRow = typeof skills.$inferSelect;
type SkillVersionRow = typeof skillVersions.$inferSelect;

@Injectable()
export class PostgresSkillRepository extends SkillRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async add(skill: Skill): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const added = await transaction
        .insert(skills)
        .values(toRow(skill))
        .onConflictDoNothing()
        .returning({ name: skills.name });
      if (added.length === 0) throw new SkillRefused([skillNameTaken(skill.name)]);
      await transaction.insert(skillVersions).values(currentVersionOf(skill));
    });
  }

  async find(name: string): Promise<Skill | undefined> {
    const [row] = await this.database.select().from(skills).where(eq(skills.name, name));
    return row && toSkill(row);
  }

  async list(): Promise<readonly Skill[]> {
    const rows = await this.database
      .select()
      .from(skills)
      .orderBy(asc(skills.addedAt), asc(skills.name));
    return rows.map(toSkill);
  }

  async versions(name: string): Promise<readonly SkillVersion[]> {
    const rows = await this.database
      .select()
      .from(skillVersions)
      .where(eq(skillVersions.skillName, name))
      .orderBy(asc(skillVersions.version));
    return rows.map(toVersion);
  }

  async update<Event extends DomainEvent>(
    name: string,
    change: (skill: Skill) => SkillChange<Event> | undefined,
  ): Promise<SkillUpdate<Event>> {
    return this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select()
        .from(skills)
        .where(eq(skills.name, name))
        .for("update");
      if (!row) throw new SkillNotFound(name);
      const skill = toSkill(row);
      const changed = change(skill);
      if (!changed) return { skill, event: undefined };
      await transaction.update(skills).set(toRow(changed.skill)).where(eq(skills.name, name));
      if (changed.skill.version !== skill.version) {
        await transaction.insert(skillVersions).values(currentVersionOf(changed.skill));
      }
      return changed;
    });
  }

  async remove(name: string): Promise<Skill> {
    const [row] = await this.database.delete(skills).where(eq(skills.name, name)).returning();
    if (!row) throw new SkillNotFound(name);
    return toSkill(row);
  }
}

function toRow(skill: Skill): SkillRow {
  return {
    name: skill.name,
    description: skill.description,
    source: skill.source,
    sourceRepository: skill.installedFrom?.repository ?? null,
    sourceFolder: skill.installedFrom?.folder ?? null,
    pinnedTag: skill.installedFrom?.pinnedVersion.tag ?? null,
    pinnedCommit: skill.installedFrom?.pinnedVersion.commit ?? null,
    version: skill.version,
    filesHash: skill.filesHash,
    state: skill.state,
    everyone: skill.everyone,
    addedAt: skill.addedAt,
    savedAt: skill.savedAt,
  };
}

function toSkill(row: SkillRow): Skill {
  const installedFrom = installedSourceOf(row);
  return {
    name: row.name,
    description: row.description,
    source: row.source,
    ...(installedFrom && { installedFrom }),
    version: row.version,
    filesHash: row.filesHash,
    state: row.state,
    everyone: row.everyone,
    addedAt: row.addedAt,
    savedAt: row.savedAt,
  };
}

function installedSourceOf(row: SkillRow): InstalledSource | undefined {
  // The table's check keeps these set exactly for an installed skill.
  if (row.sourceRepository === null || row.sourceFolder === null || row.pinnedCommit === null) {
    return undefined;
  }
  return {
    repository: row.sourceRepository,
    folder: row.sourceFolder,
    pinnedVersion: {
      ...(row.pinnedTag !== null && { tag: row.pinnedTag }),
      commit: row.pinnedCommit,
    },
  };
}

function toVersion(row: SkillVersionRow): SkillVersion {
  return {
    skillName: row.skillName,
    version: row.version,
    filesHash: row.filesHash,
    description: row.description,
    savedAt: row.savedAt,
  };
}

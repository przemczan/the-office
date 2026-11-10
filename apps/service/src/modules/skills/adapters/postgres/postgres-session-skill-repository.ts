import { Inject, Injectable } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { SessionSkillRecord } from "../../domain/session-skills.js";
import { SkillRefused } from "../../domain/skill-refused.js";
import { SessionSkillRepository } from "../../ports/session-skill-repository.js";
import { sessionSkills } from "./skills.schema.js";

type SessionSkillRow = typeof sessionSkills.$inferSelect;

@Injectable()
export class PostgresSessionSkillRepository extends SessionSkillRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async add(record: SessionSkillRecord): Promise<void> {
    const added = await this.database
      .insert(sessionSkills)
      .values(toRow(record))
      .onConflictDoNothing()
      .returning({ sessionId: sessionSkills.sessionId });
    if (added.length === 0) {
      throw new SkillRefused([`Session ${record.sessionId} already has its skills.`]);
    }
  }

  async find(sessionId: string): Promise<SessionSkillRecord | undefined> {
    const [row] = await this.database
      .select()
      .from(sessionSkills)
      .where(eq(sessionSkills.sessionId, sessionId));
    return row && toRecord(row);
  }

  async list(): Promise<readonly SessionSkillRecord[]> {
    const rows = await this.database
      .select()
      .from(sessionSkills)
      .orderBy(asc(sessionSkills.preparedAt), asc(sessionSkills.sessionId));
    return rows.map(toRecord);
  }

  async remove(sessionId: string): Promise<void> {
    await this.database.delete(sessionSkills).where(eq(sessionSkills.sessionId, sessionId));
  }
}

function toRow(record: SessionSkillRecord): SessionSkillRow {
  return {
    sessionId: record.sessionId,
    skills: record.skills.map(({ name, version, filesHash }) => ({ name, version, filesHash })),
    projectId: record.projectId ?? null,
    projectSkills: record.projectSkills.map(({ key, listedAs }) => ({ key, listedAs })),
    projectSkillsOff: [...record.projectSkillsOff],
    preparedAt: record.preparedAt,
  };
}

function toRecord(row: SessionSkillRow): SessionSkillRecord {
  return {
    sessionId: row.sessionId,
    skills: row.skills,
    projectId: row.projectId ?? undefined,
    projectSkills: row.projectSkills,
    projectSkillsOff: row.projectSkillsOff,
    preparedAt: row.preparedAt,
  };
}

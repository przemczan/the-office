import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type {
  ProjectSettingChange,
  SettingChangeToRecord,
} from "../../domain/project-setting-change.js";
import { recordOf, type SettingChangeRecording } from "../../domain/setting-change-summaries.js";
import { ProjectSettingChangeRepository } from "../../ports/project-setting-change-repository.js";
import { projectSettingChanges } from "./project-setting-changes.schema.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

@Injectable()
export class PostgresProjectSettingChangeRepository extends ProjectSettingChangeRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async latestOf(projectId: string, limit: number): Promise<readonly ProjectSettingChange[]> {
    const rows = await this.database
      .select()
      .from(projectSettingChanges)
      .where(eq(projectSettingChanges.projectId, projectId))
      .orderBy(desc(projectSettingChanges.at), desc(projectSettingChanges.id))
      .limit(limit);
    return rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      setting: row.setting,
      summary: row.summary,
      by: row.by,
      at: row.at,
    }));
  }
}

/**
 * Records a setting's change within the transaction that saves it, so the record and the change
 * are kept together or not at all; nothing without a recording.
 */
export async function recordSettingChange<Stored>(
  transaction: Transaction,
  projectId: string,
  recording: SettingChangeRecording<Stored> | undefined,
  before: Stored,
  after: Stored,
): Promise<void> {
  if (recording === undefined) return;
  const { setting, summary, by }: SettingChangeToRecord = recordOf(recording, before, after);
  await transaction
    .insert(projectSettingChanges)
    .values({ id: randomUUID(), projectId, setting, summary, by, at: new Date() });
}

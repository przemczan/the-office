import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { isDutyKey, type DutyAssignments, type DutyKey } from "../../domain/duties.js";
import { DutyRepository, type DutyAssignment } from "../../ports/duty-repository.js";
import { dutyAssignments } from "./duties.schema.js";

@Injectable()
export class PostgresDutyRepository extends DutyRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async assignments(): Promise<DutyAssignments> {
    const rows = await this.database.select().from(dutyAssignments);
    // A row of a duty The Office no longer has is left out.
    return Object.fromEntries(
      rows.filter((row) => isDutyKey(row.duty)).map((row) => [row.duty, row.roleKey]),
    );
  }

  async assign(duty: DutyKey, roleKey: string | null, at: Date): Promise<void> {
    await this.assignAll([{ duty, roleKey }], at);
  }

  async assignAll(changes: readonly DutyAssignment[], at: Date): Promise<void> {
    await assignDuties(this.database, changes, at);
  }
}

/** Sets every duty of `changes` in one statement, so all of them or none; `database` may be a transaction. */
export async function assignDuties(
  database: Pick<Database, "insert">,
  changes: readonly DutyAssignment[],
  at: Date,
): Promise<void> {
  if (changes.length === 0) return;
  await database
    .insert(dutyAssignments)
    .values(changes.map(({ duty, roleKey }) => ({ duty, roleKey, changedAt: at })))
    .onConflictDoUpdate({
      target: dutyAssignments.duty,
      set: { roleKey: sql`excluded.role_key`, changedAt: sql`excluded.changed_at` },
    });
}

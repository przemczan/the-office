import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { EarlierRecords } from "../../../../platform/earlier-records/earlier-records.js";
import type { SignedInUser } from "../../../../platform/http/signed-in-requests.js";
import type { UserRef } from "../../domain/user.js";
import { memoryNotes } from "./memory.schema.js";
import { roleCardVersions } from "./roles.schema.js";

/**
 * People's claim on its records from before users existed (spec §2.10): every Role card version and
 * every Memory note a user wrote that names no user (jsonb null, as migration 0143 left them) names
 * the first user. One UPDATE each, touching only what still names none, so running it again
 * changes nothing; a version no user saved (SQL null) and an Agent's note stay as they are.
 */
@Injectable()
export class PeopleEarlierRecords implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly earlierRecords: EarlierRecords,
  ) {}

  onModuleInit(): void {
    this.earlierRecords.add("people", (firstUser) => this.claimFor(firstUser));
  }

  private async claimFor({ userId, name }: SignedInUser): Promise<void> {
    const ref: UserRef = { userId, name };
    const user = sql`${JSON.stringify(ref)}::jsonb`;
    await this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`update ${roleCardVersions} set ${sql.identifier(roleCardVersions.savedBy.name)} = ${user}
          where jsonb_typeof(${roleCardVersions.savedBy}) = 'null'`,
      );
      await transaction.execute(
        sql`update ${memoryNotes} set ${sql.identifier(memoryNotes.source.name)} = jsonb_set(${memoryNotes.source}, '{user}', ${user})
          where ${memoryNotes.source} ->> 'kind' = 'user' and jsonb_typeof(${memoryNotes.source} -> 'user') = 'null'`,
      );
    });
  }
}

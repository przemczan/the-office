import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { EarlierRecords } from "../../../../platform/earlier-records/earlier-records.js";
import type { SignedInUser } from "../../../../platform/http/signed-in-requests.js";
import type { UserRef } from "../../domain/user.js";
import { roleSkillChanges } from "./skills.schema.js";

/**
 * Skills' claim on its records from before users existed (spec §2.10): every change of a Role's
 * skills that names no user (jsonb null, as migration 0143 left them) names the first user. One
 * UPDATE, touching only what still names none, so running it again changes nothing; a change no
 * user made (SQL null) stays as it is.
 */
@Injectable()
export class SkillsEarlierRecords implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly earlierRecords: EarlierRecords,
  ) {}

  onModuleInit(): void {
    this.earlierRecords.add("skills", (firstUser) => this.claimFor(firstUser));
  }

  private async claimFor({ userId, name }: SignedInUser): Promise<void> {
    const ref: UserRef = { userId, name };
    await this.database.execute(
      sql`update ${roleSkillChanges} set ${sql.identifier(roleSkillChanges.changedBy.name)} = ${JSON.stringify(ref)}::jsonb
        where jsonb_typeof(${roleSkillChanges.changedBy}) = 'null'`,
    );
  }
}

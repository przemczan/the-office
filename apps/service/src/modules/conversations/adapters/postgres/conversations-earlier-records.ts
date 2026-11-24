import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { EarlierRecords } from "../../../../platform/earlier-records/earlier-records.js";
import type { SignedInUser } from "../../../../platform/http/signed-in-requests.js";
import type { UserRef } from "../../domain/user.js";
import { officeInstructionsVersions } from "./office-instructions.schema.js";
import { decisions, proposals, threadMessages } from "./threads.schema.js";

/**
 * Conversations' claim on its records from before users existed (spec §2.10): every user message,
 * Allow changes line, Decision answer (the user's own and one given at their request), Proposal
 * applied or declined and Office instructions version that names no user names the first user. One
 * UPDATE each, touching only what still names none, so running it again changes nothing; what an
 * Agent or The Office did names no user and stays so. The log's UPDATEs read every message of every
 * Thread: the users module runs claims until they finish once, never at each start.
 */
@Injectable()
export class ConversationsEarlierRecords implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly earlierRecords: EarlierRecords,
  ) {}

  onModuleInit(): void {
    this.earlierRecords.add("conversations", (firstUser) => this.claimFor(firstUser));
  }

  private async claimFor({ userId, name }: SignedInUser): Promise<void> {
    const ref: UserRef = { userId, name };
    const user = sql`${JSON.stringify(ref)}::jsonb`;
    const body = sql.identifier(threadMessages.body.name);
    const answer = sql.identifier(decisions.answer.name);
    await this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`update ${threadMessages} set ${body} = jsonb_set(${threadMessages.body}, '{writtenBy}', ${user})
          where ${threadMessages.body} ->> 'kind' = 'user' and ${unnamed(sql`${threadMessages.body} -> 'writtenBy'`)}`,
      );
      await transaction.execute(
        sql`update ${threadMessages} set ${body} = jsonb_set(${threadMessages.body}, '{by}', ${user})
          where ${threadMessages.body} ->> 'kind' = 'changes-allowed' and ${unnamed(sql`${threadMessages.body} -> 'by'`)}`,
      );
      await transaction.execute(
        sql`update ${threadMessages} set ${body} = jsonb_set(${threadMessages.body}, '{atUsersRequest,user}', ${user})
          where ${threadMessages.body} ->> 'kind' = 'decision-answer' and ${unnamed(sql`${threadMessages.body} -> 'atUsersRequest' -> 'user'`)}`,
      );
      await transaction.execute(
        sql`update ${decisions} set ${answer} = jsonb_set(${decisions.answer}, '{user}', ${user})
          where ${unnamed(sql`${decisions.answer} -> 'user'`)}`,
      );
      await transaction.execute(
        sql`update ${decisions} set ${answer} = jsonb_set(${decisions.answer}, '{atUsersRequest,user}', ${user})
          where ${unnamed(sql`${decisions.answer} -> 'atUsersRequest' -> 'user'`)}`,
      );
      await transaction.execute(
        sql`update ${proposals} set ${sql.identifier(proposals.statusBy.name)} = ${user}
          where ${proposals.status} <> 'open' and ${proposals.statusBy} is null and ${proposals.declinedBecause} is null`,
      );
      await transaction.execute(
        sql`update ${officeInstructionsVersions} set ${sql.identifier(officeInstructionsVersions.savedBy.name)} = ${user}
          where ${officeInstructionsVersions.savedBy} is null`,
      );
    });
  }
}

/**
 * Whether the jsonb field holds null: a user field as kept from before users existed. A field left
 * out, as on what an Agent did, is SQL null and stays unclaimed.
 */
function unnamed(field: SQL): SQL {
  return sql`jsonb_typeof(${field}) = 'null'`;
}

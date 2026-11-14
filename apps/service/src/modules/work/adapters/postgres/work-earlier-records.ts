import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { sql, type AnyColumn, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { EarlierRecords } from "../../../../platform/earlier-records/earlier-records.js";
import type { SignedInUser } from "../../../../platform/http/signed-in-requests.js";
import { byTheUser } from "../../domain/author.js";
import { queue } from "./queue.schema.js";
import { attachments, ideas, initiatives, tasks, taskStateChanges } from "./work.schema.js";

/**
 * Work's claim on its records from before users existed (spec §2.10): every Author that says only
 * "the user" names the first user, one UPDATE per column, touching only rows still lacking a user,
 * so running it again changes nothing. A start by the queue kept before who queued it was stays as
 * it is.
 */
@Injectable()
export class WorkEarlierRecords implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly earlierRecords: EarlierRecords,
  ) {}

  onModuleInit(): void {
    this.earlierRecords.add("work", (firstUser) => this.claimFor(firstUser));
  }

  private async claimFor(firstUser: SignedInUser): Promise<void> {
    const author = sql`${JSON.stringify(byTheUser({ userId: firstUser.userId, name: firstUser.name }))}::jsonb`;
    await this.database.transaction(async (transaction) => {
      const columns: readonly (readonly [PgTable, AnyColumn])[] = [
        [ideas, ideas.capturedBy],
        [initiatives, initiatives.createdBy],
        [initiatives, initiatives.restoredBy],
        [initiatives, initiatives.planningStartedBy],
        [tasks, tasks.createdBy],
        [tasks, tasks.restoredBy],
        [taskStateChanges, taskStateChanges.changedBy],
        [attachments, attachments.addedBy],
        [queue, queue.queuedBy],
      ];
      for (const [table, column] of columns) {
        await transaction.execute(
          sql`update ${table} set ${sql.identifier(column.name)} = ${author} where ${unnamedUser(sql`${column}`)}`,
        );
      }
      const queuedBy = sql`${taskStateChanges.changedBy} -> 'queuedBy'`;
      await transaction.execute(
        sql`update ${taskStateChanges} set ${sql.identifier(taskStateChanges.changedBy.name)} = jsonb_set(${taskStateChanges.changedBy}, '{queuedBy}', ${author}) where ${taskStateChanges.changedBy} ->> 'kind' = 'queue' and ${unnamedUser(queuedBy)}`,
      );
      await transaction.execute(
        sql`update ${tasks} set ${sql.identifier(tasks.projectMoves.name)} = (
          select jsonb_agg(case when ${unnamedUser(sql`move -> 'by'`)} then jsonb_set(move, '{by}', ${author}) else move end order by at)
          from jsonb_array_elements(${tasks.projectMoves}) with ordinality as moves(move, at)
        ) where exists (
          select from jsonb_array_elements(${tasks.projectMoves}) as moves(move) where ${unnamedUser(sql`move -> 'by'`)}
        )`,
      );
    });
  }
}

/** Whether the jsonb Author is a user's with no user named: one from before users existed. */
function unnamedUser(author: SQL): SQL {
  return sql`(${author} ->> 'kind' = 'user' and ${author} ->> 'user' is null)`;
}

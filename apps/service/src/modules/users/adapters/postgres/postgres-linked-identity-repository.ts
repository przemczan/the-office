import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { IdentityProviderId, LinkedIdentity } from "../../domain/linked-identity.js";
import { LinkedIdentityRepository } from "../../ports/linked-identity-repository.js";
import { linkedIdentities } from "./linked-identities.schema.js";

type LinkedIdentityRow = typeof linkedIdentities.$inferSelect;

@Injectable()
export class PostgresLinkedIdentityRepository extends LinkedIdentityRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async listOf(userId: string): Promise<readonly LinkedIdentity[]> {
    const rows = await this.database
      .select()
      .from(linkedIdentities)
      .where(eq(linkedIdentities.userId, userId))
      .orderBy(asc(linkedIdentities.linkedAt), asc(linkedIdentities.id));
    return rows.map(toLinkedIdentity);
  }

  async findBySubject(
    provider: IdentityProviderId,
    subject: string,
  ): Promise<LinkedIdentity | undefined> {
    const [row] = await this.database
      .select()
      .from(linkedIdentities)
      .where(and(eq(linkedIdentities.provider, provider), eq(linkedIdentities.subject, subject)));
    return row && toLinkedIdentity(row);
  }

  async add(identity: LinkedIdentity): Promise<boolean> {
    // Either unique index taken, by a link at the same moment too, keeps nothing.
    const added = await this.database
      .insert(linkedIdentities)
      .values({ ...identity, lastSignedInAt: identity.lastSignedInAt ?? null })
      .onConflictDoNothing()
      .returning({ id: linkedIdentities.id });
    return added.length > 0;
  }

  async save({ id, name, lastSignedInAt }: LinkedIdentity): Promise<void> {
    await this.database
      .update(linkedIdentities)
      .set({ name, lastSignedInAt: lastSignedInAt ?? null })
      .where(eq(linkedIdentities.id, id));
  }

  async remove(userId: string, provider: IdentityProviderId): Promise<boolean> {
    const removed = await this.database
      .delete(linkedIdentities)
      .where(and(eq(linkedIdentities.userId, userId), eq(linkedIdentities.provider, provider)))
      .returning({ id: linkedIdentities.id });
    return removed.length > 0;
  }

  async removeAllOf(userId: string): Promise<void> {
    await this.database.delete(linkedIdentities).where(eq(linkedIdentities.userId, userId));
  }
}

function toLinkedIdentity(row: LinkedIdentityRow): LinkedIdentity {
  return { ...row, lastSignedInAt: row.lastSignedInAt ?? undefined };
}

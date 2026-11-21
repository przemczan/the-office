import { Inject, Injectable } from "@nestjs/common";
import { eq, lt, sql } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { ActivitySeenRepository } from "../../ports/activity-seen-repository.js";
import { activitySeen } from "./activity.schema.js";

@Injectable()
export class PostgresActivitySeenRepository extends ActivitySeenRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async seenOf(userId: string): Promise<ReadonlySet<string>> {
    const rows = await this.database
      .select({ itemId: activitySeen.itemId })
      .from(activitySeen)
      .where(eq(activitySeen.userId, userId));
    return new Set(rows.map(({ itemId }) => itemId));
  }

  async markSeen(userId: string, itemIds: readonly string[], at: Date): Promise<void> {
    if (itemIds.length === 0) return;
    await this.database
      .insert(activitySeen)
      .values([...new Set(itemIds)].map((itemId) => ({ userId, itemId, seenAt: at })))
      .onConflictDoUpdate({
        target: [activitySeen.userId, activitySeen.itemId],
        set: { seenAt: sql`greatest(${activitySeen.seenAt}, excluded.seen_at)` },
      });
  }

  async forgetBefore(before: Date): Promise<void> {
    await this.database.delete(activitySeen).where(lt(activitySeen.seenAt, before));
  }
}

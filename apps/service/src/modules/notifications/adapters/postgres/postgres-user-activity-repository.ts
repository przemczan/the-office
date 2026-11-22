import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { UserActivity } from "../../domain/user-activity.js";
import { UserActivityRepository } from "../../ports/user-activity-repository.js";
import { userActivity } from "./notifications.schema.js";

type Row = typeof userActivity.$inferSelect;

@Injectable()
export class PostgresUserActivityRepository extends UserActivityRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async find(userId: string): Promise<UserActivity | undefined> {
    const [row] = await this.database
      .select()
      .from(userActivity)
      .where(eq(userActivity.userId, userId));
    return row && activityOf(row);
  }

  /**
   * Holds the user's row while the change is worked out. Before the user is first seen there is no
   * row to hold; two first activities at once each keep the same first sight, so the later one may
   * win.
   */
  async update(
    userId: string,
    change: (known: UserActivity | undefined) => UserActivity,
  ): Promise<{ readonly before: UserActivity | undefined; readonly after: UserActivity }> {
    return this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select()
        .from(userActivity)
        .where(eq(userActivity.userId, userId))
        .for("update");
      const before = row && activityOf(row);
      const after = change(before);
      await transaction
        .insert(userActivity)
        .values({ userId, ...after })
        .onConflictDoUpdate({ target: userActivity.userId, set: after });
      return { before, after };
    });
  }
}

function activityOf({ lastActiveAt, leftAt }: Row): UserActivity {
  return { lastActiveAt, leftAt };
}

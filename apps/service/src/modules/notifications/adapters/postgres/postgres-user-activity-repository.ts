import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { UserActivity } from "../../domain/user-activity.js";
import { UserActivityRepository } from "../../ports/user-activity-repository.js";
import { userActivity } from "./notifications.schema.js";

@Injectable()
export class PostgresUserActivityRepository extends UserActivityRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async find(): Promise<UserActivity | undefined> {
    const [row] = await this.database.select().from(userActivity).limit(1);
    return row && { lastActiveAt: row.lastActiveAt, leftAt: row.leftAt };
  }

  /**
   * Holds the row while the change is worked out. Before the user is first seen there is no row to
   * hold; two first activities at once each keep the same first sight, so the later one may win.
   */
  async update(change: (known: UserActivity | undefined) => UserActivity): Promise<UserActivity> {
    return this.database.transaction(async (transaction) => {
      const [row] = await transaction.select().from(userActivity).limit(1).for("update");
      const changed = change(row && { lastActiveAt: row.lastActiveAt, leftAt: row.leftAt });
      await transaction
        .insert(userActivity)
        .values(changed)
        .onConflictDoUpdate({ target: userActivity.id, set: changed });
      return changed;
    });
  }
}

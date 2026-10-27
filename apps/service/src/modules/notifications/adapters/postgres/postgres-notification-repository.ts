import { Inject, Injectable } from "@nestjs/common";
import { and, asc, inArray, isNull } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { Notification } from "../../domain/notification.js";
import { NotificationRepository } from "../../ports/notification-repository.js";
import { notifications } from "./notifications.schema.js";

@Injectable()
export class PostgresNotificationRepository extends NotificationRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async add(notification: Notification): Promise<void> {
    await this.database
      .insert(notifications)
      .values({ ...notification, roleKey: notification.roleKey ?? null });
  }

  async listOpen(): Promise<readonly Notification[]> {
    const rows = await this.database
      .select()
      .from(notifications)
      .where(isNull(notifications.clearedAt))
      .orderBy(asc(notifications.raisedAt));
    return rows.map(({ clearedAt: _clearedAt, roleKey, ...notification }) => ({
      ...notification,
      roleKey: roleKey ?? undefined,
    }));
  }

  async clear(ids: readonly string[], clearedAt: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.database
      .update(notifications)
      .set({ clearedAt })
      .where(and(inArray(notifications.id, [...ids]), isNull(notifications.clearedAt)));
  }
}

import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { receivedBy } from "../../domain/delivery.js";
import type { Channel } from "../../domain/notification-kinds.js";
import type { Delivery, Notification, ReceivedNotification } from "../../domain/notification.js";
import { NotificationRepository } from "../../ports/notification-repository.js";
import { notificationDeliveries, notifications } from "./notifications.schema.js";

type NotificationRow = typeof notifications.$inferSelect;
type DeliveryRow = typeof notificationDeliveries.$inferSelect;

@Injectable()
export class PostgresNotificationRepository extends NotificationRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async add({
    id,
    kind,
    roleKey,
    line,
    shortLine,
    at,
    pointsTo,
    raisedAt,
    gathers,
    forUser,
  }: Notification): Promise<void> {
    await this.database.insert(notifications).values({
      id,
      kind,
      roleKey: roleKey ?? null,
      line,
      shortLine: shortLine ?? null,
      at: at ?? null,
      pointsTo,
      raisedAt,
      gathers,
      forUser: forUser ?? null,
    });
  }

  async deliver({
    notificationId,
    userId,
    channels,
    held,
    phonePushedAt,
  }: Delivery): Promise<void> {
    await this.database
      .insert(notificationDeliveries)
      .values({ notificationId, userId, channels, held, phonePushedAt: phonePushedAt ?? null });
  }

  async listOpen(): Promise<readonly Notification[]> {
    const rows = await this.database
      .select()
      .from(notifications)
      .where(isNull(notifications.clearedAt))
      .orderBy(asc(notifications.raisedAt));
    return rows.map(notificationOf);
  }

  async listReceived(userId: string): Promise<readonly ReceivedNotification[]> {
    const [open, deliveries] = await Promise.all([
      this.listOpen(),
      this.database
        .select({ delivery: notificationDeliveries })
        .from(notificationDeliveries)
        .innerJoin(notifications, eq(notifications.id, notificationDeliveries.notificationId))
        .where(and(eq(notificationDeliveries.userId, userId), isNull(notifications.clearedAt))),
    ]);
    return receivedBy(
      userId,
      open,
      deliveries.map(({ delivery }) => deliveryOf(delivery)),
    );
  }

  async clear(ids: readonly string[], clearedAt: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.database
      .update(notifications)
      .set({ clearedAt })
      .where(and(inArray(notifications.id, [...ids]), isNull(notifications.clearedAt)));
  }

  async hold(userId: string, ids: readonly string[], held: readonly Channel[]): Promise<void> {
    if (ids.length === 0) return;
    await this.database
      .update(notificationDeliveries)
      .set({ held })
      .where(
        and(
          eq(notificationDeliveries.userId, userId),
          inArray(notificationDeliveries.notificationId, [...ids]),
        ),
      );
  }

  async phonePushed(userId: string, id: string, pushedAt: Date): Promise<void> {
    await this.database
      .update(notificationDeliveries)
      .set({ phonePushedAt: pushedAt })
      .where(
        and(
          eq(notificationDeliveries.userId, userId),
          eq(notificationDeliveries.notificationId, id),
        ),
      );
  }
}

function notificationOf({
  id,
  kind,
  roleKey,
  line,
  shortLine,
  at,
  pointsTo,
  raisedAt,
  gathers,
  forUser,
}: NotificationRow): Notification {
  return {
    id,
    kind,
    roleKey: roleKey ?? undefined,
    line,
    shortLine: shortLine ?? undefined,
    at: at ?? undefined,
    pointsTo,
    raisedAt,
    gathers,
    forUser: forUser ?? undefined,
  };
}

function deliveryOf({ phonePushedAt, ...delivery }: DeliveryRow): Delivery {
  return { ...delivery, phonePushedAt: phonePushedAt ?? undefined };
}

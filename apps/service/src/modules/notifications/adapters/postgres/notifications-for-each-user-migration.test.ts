import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { INestApplication } from "@nestjs/common";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { rolledBackMigration } from "../../../../../test/test-database.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import {
  notificationDeliveries,
  userNotificationRouting,
  userNotificationTiming,
} from "./notifications.schema.js";

let app: INestApplication;
let database: Database;

beforeAll(async () => {
  ({ app } = await startTestApplication({ database: true }));
  database = app.get(DATABASE);
});

afterAll(async () => {
  await app.close();
});

describe("migration 0191", () => {
  it("gives each user there is the Office's routing, timing and open Notifications, and a removed user none", async () => {
    const migration = await readFile(
      new URL("../../../../../drizzle/0191_notifications_for_each_user.sql", import.meta.url),
      "utf8",
    );
    const [user, removed] = [`user-${randomUUID()}`, `user-${randomUUID()}`];
    const [open, cleared, nowhere] = [randomUUID(), randomUUID(), randomUUID()];

    const after = await rolledBackMigration(database, async (transaction) => {
      // As before migration 0191.
      await transaction.execute(sql`DROP TABLE "notification_deliveries"`);
      await transaction.execute(sql`DROP TABLE "user_notification_routing"`);
      await transaction.execute(sql`DROP TABLE "user_notification_timing"`);
      await transaction.execute(sql`ALTER TABLE "notifications" DROP COLUMN "for_user"`);
      await transaction.execute(sql`
        INSERT INTO "users" ("id", "name", "email", "created_at", "removed_at") VALUES
          (${user}, 'Ada', ${`${user}@example.com`}, now(), NULL),
          (${removed}, 'Ben', ${`${removed}@example.com`}, now(), now())`);
      await transaction.execute(sql`DELETE FROM "notification_routing"`);
      await transaction.execute(
        sql`INSERT INTO "notification_routing" ("level", "channel", "on") VALUES ('office.window', 'phone', true)`,
      );
      await transaction.execute(sql`
        UPDATE "notification_timing"
        SET "hold_phone_minutes" = 10, "quiet_from" = '22:00', "quiet_to" = '07:00'`);
      for (const [id, channels, clearedAt] of [
        [open, '["in-app","desktop"]', null],
        [cleared, '["in-app"]', new Date().toISOString()],
        [nowhere, "[]", null],
      ] as const) {
        await transaction.execute(sql`
          INSERT INTO "notifications"
            ("id", "kind", "line", "points_to", "raised_at", "cleared_at", "channels", "held")
          VALUES (${id}, 'needs-you.decision', 'Keep it?', '{"kind":"office"}', now(),
            ${clearedAt}, ${channels}::jsonb, '["desktop"]'::jsonb)`);
      }

      for (const statement of migration.split("--> statement-breakpoint")) {
        await transaction.execute(sql.raw(statement));
      }

      return {
        routing: await transaction
          .select()
          .from(userNotificationRouting)
          .where(inArray(userNotificationRouting.userId, [user, removed])),
        timing: await transaction
          .select()
          .from(userNotificationTiming)
          .where(inArray(userNotificationTiming.userId, [user, removed])),
        deliveries: await transaction
          .select()
          .from(notificationDeliveries)
          .where(inArray(notificationDeliveries.notificationId, [open, cleared, nowhere])),
        othersDeliveries: await transaction
          .select({ userId: notificationDeliveries.userId })
          .from(notificationDeliveries)
          .where(eq(notificationDeliveries.userId, removed)),
      };
    });

    expect(after.routing).toEqual([
      { userId: user, level: "office.window", channel: "phone", on: true },
    ]);
    expect(after.timing).toEqual([
      {
        userId: user,
        holdPhoneMinutes: 10,
        awayMinutes: 5,
        batchOutcomesMinutes: 2,
        quietFrom: "22:00",
        quietTo: "07:00",
      },
    ]);
    // Each user there is gets the open one as The Office had it; the cleared and the unrouted none.
    expect(after.deliveries.filter(({ notificationId }) => notificationId !== open)).toEqual([]);
    expect(after.deliveries.find(({ userId }) => userId === user)).toEqual({
      notificationId: open,
      userId: user,
      channels: ["in-app", "desktop"],
      held: ["desktop"],
      phonePushedAt: null,
    });
    expect(after.othersDeliveries).toEqual([]);
  });
});

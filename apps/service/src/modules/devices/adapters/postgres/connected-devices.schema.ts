import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  ConnectedDeviceKind,
  ConnectedDeviceState,
  DeviceUser,
  DisconnectedBecause,
  HelperNoticeCode,
} from "../../domain/connected-device.js";

/**
 * Each Connected device (spec §2.13), the Disconnected ones kept as their Task's history. Its Task
 * and Project are Work's and Projects' records, named by id alone.
 */
export const connectedDevices = pgTable(
  "connected_devices",
  {
    id: uuid("id").primaryKey(),
    taskId: uuid("task_id").notNull(),
    projectId: text("project_id").notNull(),
    kind: text("kind").$type<ConnectedDeviceKind>().notNull(),
    name: text("name").notNull(),
    deviceKey: text("device_key").notNull(),
    state: text("state").$type<ConnectedDeviceState>().notNull(),
    disconnectedBecause: text("disconnected_because").$type<DisconnectedBecause>(),
    disconnectedBy: jsonb("disconnected_by").$type<DeviceUser>(),
    problem: text("problem"),
    endpoint: text("endpoint"),
    /** A serial board's RFC 2217 address while Connected. */
    rfc2217Url: text("rfc2217_url"),
    baudRate: integer("baud_rate"),
    roundTripMs: integer("round_trip_ms"),
    /** The helper's latest notice since its READY. */
    notice: text("notice").$type<HelperNoticeCode>(),
    connectedBy: jsonb("connected_by").$type<DeviceUser>().notNull(),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull(),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
  },
  (table) => [
    index("connected_devices_task").on(table.taskId, table.connectedAt),
    // A device connects to one Task at a time (spec §2.13, "One device to one Task").
    uniqueIndex("connected_devices_open_device_key")
      .on(table.deviceKey)
      .where(sql`${table.state} <> 'disconnected'`),
  ],
);

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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
  DeviceConnector,
  DeviceUser,
  DisconnectedBecause,
  HelperNoticeCode,
} from "../../domain/connected-device.js";

/**
 * Each Connected device (spec §2.13), the Disconnected ones kept as their holder's history. Its
 * holder (a Task, an Action run or a test instance, exactly one) and Project are other modules'
 * records, named by id alone.
 */
export const connectedDevices = pgTable(
  "connected_devices",
  {
    id: uuid("id").primaryKey(),
    /** The Task it is connected to; null for an Action run's or a test instance's hold. */
    taskId: uuid("task_id"),
    /** The Action run that holds a Project device. */
    actionRunId: uuid("action_run_id"),
    /** The test instance that holds a Project device. */
    testInstanceId: uuid("test_instance_id"),
    /** A run's name as "<device> is in use by <name>." says it, written by the run as it holds it. */
    holderName: text("holder_name"),
    /** The tab that relays a run's device over USB. */
    relayTab: uuid("relay_tab"),
    /** Whether it was ever Connected, kept so a restart doesn't forget it (spec §2.13). */
    everConnected: boolean("ever_connected").notNull().default(false),
    projectId: text("project_id").notNull(),
    /** The Project device it was lent from; its uses stay named here once it is removed. */
    projectDeviceId: uuid("project_device_id"),
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
    connectedBy: jsonb("connected_by").$type<DeviceConnector>().notNull(),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull(),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
  },
  (table) => [
    index("connected_devices_task").on(table.taskId, table.connectedAt),
    // Exactly one holder: a Task, an Action run or a test instance.
    check(
      "connected_devices_one_holder",
      sql`num_nonnulls(${table.taskId}, ${table.actionRunId}, ${table.testInstanceId}) = 1`,
    ),
    // A device connects to one Task at a time (spec §2.13, "One device to one Task").
    uniqueIndex("connected_devices_open_device_key")
      .on(table.deviceKey)
      .where(sql`${table.state} <> 'disconnected'`),
  ],
);

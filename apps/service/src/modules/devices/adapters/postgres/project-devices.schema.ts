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
import type { ConnectedDeviceKind, DeviceUser } from "../../domain/connected-device.js";
import type {
  ProjectDeviceLastUse,
  ProjectDevicePairingStep,
  ProjectDeviceRestState,
} from "../../domain/project-device.js";

/**
 * Each Project device (spec §2.13, "A Project's device"), kept until removed. Its Project is
 * Projects' record, named by id alone, as a Project is never removed; In use is worked out from
 * `connected_devices`, never kept here.
 */
export const projectDevices = pgTable(
  "project_devices",
  {
    id: uuid("id").primaryKey(),
    projectId: text("project_id").notNull(),
    kind: text("kind").$type<ConnectedDeviceKind>().notNull(),
    deviceKey: text("device_key").notNull(),
    name: text("name").notNull(),
    /** A phone over wireless debugging's IP address and Port. */
    address: text("address"),
    port: integer("port"),
    state: text("state").$type<ProjectDeviceRestState>().notNull(),
    /** The step a pairing running now is at. */
    pairingStep: text("pairing_step").$type<ProjectDevicePairingStep>(),
    /** Why the last pairing failed, in the service's or adb's words. */
    pairingProblem: text("pairing_problem"),
    addedBy: jsonb("added_by").$type<DeviceUser>().notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull(),
    lastUse: jsonb("last_use").$type<ProjectDeviceLastUse>(),
  },
  (table) => [
    // A device key is unique among the Project's devices (spec §2.13, "A Project's device").
    uniqueIndex("project_devices_project_device_key").on(table.projectId, table.deviceKey),
    index("project_devices_project").on(table.projectId, table.addedAt),
  ],
);

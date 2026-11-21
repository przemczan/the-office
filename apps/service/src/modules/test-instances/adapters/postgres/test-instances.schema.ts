import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  LaunchedBy,
  TestInstanceKind,
  TestInstanceState,
} from "../../domain/test-instance.js";

/**
 * Each Test instance (spec §2.12, "Test instance"), kept with its log after it ends. Its Initiative
 * and Project are Work's and Projects' records, named by id alone.
 */
export const testInstances = pgTable(
  "test_instances",
  {
    id: uuid("id").primaryKey(),
    initiativeId: uuid("initiative_id").notNull(),
    projectId: text("project_id").notNull(),
    targetKey: text("target_key").notNull(),
    /** The target's name when it was launched. */
    targetName: text("target_name").notNull(),
    kind: text("kind").$type<TestInstanceKind>().notNull(),
    state: text("state").$type<TestInstanceState>().notNull(),
    /** Null until the checkout has it. */
    commit: text("commit"),
    /** The Proxy port it holds while Building or Running; null once it has ended. */
    port: integer("port"),
    /** Null unless Failed. */
    failedReason: text("failed_reason"),
    launchedBy: jsonb("launched_by").$type<LaunchedBy>().notNull(),
    launchedAt: timestamp("launched_at", { withTimezone: true }).notNull(),
    runningAt: timestamp("running_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => [
    index("test_instances_initiative").on(table.initiativeId, table.launchedAt),
    // Two instances Building or Running never share a Proxy port.
    uniqueIndex("test_instances_active_port")
      .on(table.port)
      .where(sql`${table.state} in ('building', 'running')`),
    check(
      "test_instances_state",
      sql`${table.state} in ('building', 'running', 'built', 'stopped', 'failed')`,
    ),
    check("test_instances_kind", sql`${table.kind} in ('hosted', 'build-to-install')`),
  ],
);

/**
 * The Test instances limits (spec §2.12, Defaults), in one row once Settings saves them; until
 * then the repository answers the defaults.
 */
export const testInstanceSettings = pgTable(
  "test_instance_settings",
  {
    id: smallint("id").primaryKey().default(1),
    testInstancesAtOnce: integer("test_instances_at_once").notNull().default(2),
    idleMinutes: integer("idle_minutes").notNull().default(30),
    firstProxyPort: integer("first_proxy_port").notNull().default(4400),
    lastProxyPort: integer("last_proxy_port").notNull().default(4419),
  },
  (table) => [
    check("test_instance_settings_one_row", sql`${table.id} = 1`),
    check(
      "test_instance_settings_proxy_ports",
      sql`${table.lastProxyPort} >= ${table.firstProxyPort}`,
    ),
  ],
);

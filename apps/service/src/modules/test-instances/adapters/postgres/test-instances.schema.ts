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
 * and Project are Work's and Projects' records, named by id alone; an instance linked to no
 * Initiative has none.
 */
export const testInstances = pgTable(
  "test_instances",
  {
    id: uuid("id").primaryKey(),
    initiativeId: uuid("initiative_id"),
    projectId: text("project_id").notNull(),
    /** The branch it runs; null only on rows from before it was recorded, each its Initiative's. */
    branch: text("branch"),
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
    /** A Built instance's files by name, in `<office-data>/test-builds/<id>/`; empty otherwise. */
    files: jsonb("files").$type<readonly { name: string; size: number }[]>().notNull().default([]),
    /** When a Built instance's files were removed; null while they are kept. */
    filesRemovedAt: timestamp("files_removed_at", { withTimezone: true }),
    /** The key of the Action whose run launched it; null when launched by hand. */
    actionKey: text("action_key"),
    /** That Action's name at the launch; null when launched by hand. */
    actionName: text("action_name"),
  },
  (table) => [
    index("test_instances_initiative").on(table.initiativeId, table.launchedAt),
    index("test_instances_project_branch").on(table.projectId, table.branch, table.launchedAt),
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

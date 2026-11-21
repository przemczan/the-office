import { z } from "zod";
import { webEventSchema } from "./events.js";
import { entryPointSchema, testTargetKeySchema } from "./test-targets.js";
import { authorSchema } from "./work.js";

/**
 * The kinds a Test instance may be (spec §2.12, "Kinds"): Hosted is built now, Build to install
 * comes with its own Task.
 */
export const testInstanceKindSchema = z.enum(["hosted", "build-to-install"]);
export type TestInstanceKind = z.infer<typeof testInstanceKindSchema>;

/**
 * A Test instance's state (spec §2.12, "Test instance states"): Hosted goes Building → Running →
 * Stopped, or Failed; Built is Build to install's.
 */
export const testInstanceStateSchema = z.enum([
  "building",
  "running",
  "built",
  "stopped",
  "failed",
]);
export type TestInstanceState = z.infer<typeof testInstanceStateSchema>;

/** The states that count toward Test instances at once and hold a Proxy port. */
export const ACTIVE_TEST_INSTANCE_STATES: readonly TestInstanceState[] = ["building", "running"];

/** One launch of one test target on one Initiative's branch in one Project. */
export const testInstanceSchema = z.object({
  id: z.uuid(),
  initiativeId: z.uuid(),
  projectId: z.string(),
  targetKey: z.string(),
  /** The target's name when it was launched, kept should the target be renamed or removed. */
  targetName: z.string(),
  kind: testInstanceKindSchema,
  state: testInstanceStateSchema,
  /** The branch tip it runs, fetched at launch; null until the checkout has it. */
  commit: z.string().nullable(),
  /** The Proxy port a Hosted instance was given; null once Stopped or Failed, and for Build to install. */
  port: z.number().int().nullable(),
  /** Why it failed, in the user's words; null unless Failed. */
  failedReason: z.string().nullable(),
  launchedBy: authorSchema,
  launchedAt: z.iso.datetime(),
  /** When it became Running; null before. */
  runningAt: z.iso.datetime().nullable(),
  /** When it became Stopped, Failed or Built; null while Building or Running. */
  endedAt: z.iso.datetime().nullable(),
});
export type TestInstance = z.infer<typeof testInstanceSchema>;

/** A test target of a Project as the Initiative page's Test instances block shows it. */
export const initiativeTestTargetSchema = z.object({
  key: z.string(),
  name: z.string(),
  kind: testInstanceKindSchema,
  entryPoint: entryPointSchema,
  /** Its instances on this Initiative, newest first. */
  instances: z.array(testInstanceSchema),
});
export type InitiativeTestTarget = z.infer<typeof initiativeTestTargetSchema>;

/** One Project where the Initiative has a branch, with its test targets. */
export const initiativeTestInstancesProjectSchema = z.object({
  projectId: z.string(),
  /** Whether the Project's Run environment is On, which a Hosted launch needs. */
  runEnvironmentOn: z.boolean(),
  /** The Initiative branch's last commit known here; null when it has none yet. */
  branchCommit: z.string().nullable(),
  targets: z.array(initiativeTestTargetSchema),
});
export type InitiativeTestInstancesProject = z.infer<typeof initiativeTestInstancesProjectSchema>;

/** GET /initiatives/:id/test-instances: a group per Project where the Initiative has a branch. */
export const initiativeTestInstancesSchema = z.object({
  projects: z.array(initiativeTestInstancesProjectSchema),
});
export type InitiativeTestInstances = z.infer<typeof initiativeTestInstancesSchema>;

/** POST /initiatives/:id/test-instances: launch a test target; it answers the new instance. */
export const testInstanceLaunchSchema = z.object({
  projectId: z.string(),
  targetKey: testTargetKeySchema,
});
export type TestInstanceLaunch = z.infer<typeof testInstanceLaunchSchema>;

/** POST /test-instances/:id/open: the single-use hand-off link to the instance's own address. */
export const testInstanceOpeningSchema = z.object({ url: z.string() });
export type TestInstanceOpening = z.infer<typeof testInstanceOpeningSchema>;

/**
 * GET /test-instances/:id/log?from=<offset>: the masked log from a byte offset, the offset to read
 * on from, and the instance's state, so a reader stops following once it has ended.
 */
export const testInstanceLogSchema = z.object({
  text: z.string(),
  nextOffset: z.number().int().min(0),
  state: testInstanceStateSchema,
});
export type TestInstanceLog = z.infer<typeof testInstanceLogSchema>;

/** The bounds of a Test instances limit, which the card offers and the service keeps. */
export interface TestInstanceLimitBounds {
  readonly min: number;
  readonly max: number;
}

/** Settings › Office limits: how many test instances may be Building or Running together. */
export const TEST_INSTANCES_AT_ONCE: TestInstanceLimitBounds = { min: 1, max: 6 };
/** Settings › Office limits: minutes a Running Hosted instance may go with no request. */
export const IDLE_TIME_MINUTES: TestInstanceLimitBounds = { min: 5, max: 240 };
/** Settings › Office limits: the ports a Proxy port range may use. */
export const PROXY_PORTS: TestInstanceLimitBounds = { min: 1024, max: 65_535 };
/** The most ports a Proxy port range may hold. */
export const MOST_PROXY_PORTS = 100;

function wholeNumberWithin(bounds: TestInstanceLimitBounds, error: string) {
  return z.int({ error }).min(bounds.min, { error }).max(bounds.max, { error });
}

const PROXY_PORT_ERROR = `A Proxy port is a whole number from ${PROXY_PORTS.min} to ${PROXY_PORTS.max}.`;

/**
 * GET and PUT /settings/test-instances: the three Test instances limits (spec §2.12, Defaults), the
 * whole set at once. The service also refuses a range that holds The Office's own port.
 */
export const testInstanceSettingsSchema = z
  .object({
    testInstancesAtOnce: wholeNumberWithin(
      TEST_INSTANCES_AT_ONCE,
      `Test instances at once is a whole number from ${TEST_INSTANCES_AT_ONCE.min} to ` +
        `${TEST_INSTANCES_AT_ONCE.max}.`,
    ),
    idleMinutes: wholeNumberWithin(
      IDLE_TIME_MINUTES,
      `Idle time is a whole number of minutes from ${IDLE_TIME_MINUTES.min} to ` +
        `${IDLE_TIME_MINUTES.max}.`,
    ),
    firstProxyPort: wholeNumberWithin(PROXY_PORTS, PROXY_PORT_ERROR),
    lastProxyPort: wholeNumberWithin(PROXY_PORTS, PROXY_PORT_ERROR),
  })
  .refine((settings) => settings.lastProxyPort >= settings.firstProxyPort, {
    path: ["lastProxyPort"],
    error: "The last Proxy port can't be below the first.",
  })
  .refine((settings) => settings.lastProxyPort - settings.firstProxyPort + 1 <= MOST_PROXY_PORTS, {
    path: ["lastProxyPort"],
    error: `Proxy ports hold at most ${MOST_PROXY_PORTS} ports.`,
  });
export type TestInstanceSettings = z.infer<typeof testInstanceSettingsSchema>;

/** The spec's defaults, until Settings saves others. */
export const DEFAULT_TEST_INSTANCE_SETTINGS: TestInstanceSettings = {
  testInstancesAtOnce: 2,
  idleMinutes: 30,
  firstProxyPort: 4400,
  lastProxyPort: 4419,
};

/**
 * A Test instance changed (launched, its state, stopped), so the Initiative's block reads it
 * again; or the Test instances limits changed, so Settings › Office limits reads them again.
 */
export const testInstanceWebEventSchema = z.discriminatedUnion("type", [
  webEventSchema.extend({
    type: z.literal("test-instance.changed"),
    instanceId: z.uuid(),
    initiativeId: z.uuid(),
  }),
  webEventSchema.extend({ type: z.literal("test-instance-settings.changed") }),
]);
export type TestInstanceWebEvent = z.infer<typeof testInstanceWebEventSchema>;

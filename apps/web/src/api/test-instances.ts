import { queryOptions } from "@tanstack/react-query";
import {
  API_PATH,
  healthReportSchema,
  testBuildFileLinkSchema,
  initiativeTestInstancesSchema,
  testInstanceLogSchema,
  testInstanceOpeningSchema,
  testInstanceSchema,
  testInstanceSettingsSchema,
  testInstanceWebEventSchema,
  type TestBuildFileLink,
  type TestInstance,
  type TestInstanceLaunch,
  type TestInstanceLog,
  type TestInstanceOpening,
  type TestInstanceSettings,
  type TestInstanceWebEvent,
} from "@the-office/contracts";
import { getFromApi, sendToApi } from "./api-client.ts";
import type { EventInvalidations } from "./event-stream-provider.tsx";

const TEST_INSTANCES = ["test-instances"] as const;
const SETTINGS = ["settings", "test-instances"] as const;
const HEALTH = ["health"] as const;

export const testInstanceQueries = {
  /**
   * The Initiative page's Test instances block: a group per Project on the Initiative's branch,
   * its test targets and their instances, newest first.
   */
  ofInitiative: (initiativeId: string) =>
    queryOptions({
      queryKey: [...TEST_INSTANCES, "initiative", initiativeId],
      queryFn: ({ signal }) =>
        getFromApi(
          `/initiatives/${initiativeId}/test-instances`,
          initiativeTestInstancesSchema,
          signal,
        ),
    }),
  /** Settings › Office limits: Test instances at once, Idle time and Proxy ports. */
  settings: () =>
    queryOptions({
      queryKey: SETTINGS,
      queryFn: ({ signal }) =>
        getFromApi("/settings/test-instances", testInstanceSettingsSchema, signal),
    }),
  /**
   * Whether this service is a test instance of The Office, read once: it needs no sign-in, so the
   * sign-in page shows the banner too.
   */
  health: () =>
    queryOptions({
      queryKey: HEALTH,
      queryFn: ({ signal }) => getFromApi("/health", healthReportSchema, signal),
      staleTime: Infinity,
    }),
};

/** Launches a test target on the Initiative's branch; it answers the new instance, Building. */
export function launchTestInstance(
  initiativeId: string,
  launch: TestInstanceLaunch,
): Promise<TestInstance> {
  return sendToApi(
    "POST",
    `/initiatives/${initiativeId}/test-instances`,
    launch,
    testInstanceSchema,
  );
}

export function stopTestInstance(instanceId: string): Promise<TestInstance> {
  return sendToApi("POST", `/test-instances/${instanceId}/stop`, {}, testInstanceSchema);
}

/** The single-use hand-off link to a Running instance's own address. */
export function openTestInstance(instanceId: string): Promise<TestInstanceOpening> {
  return sendToApi("POST", `/test-instances/${instanceId}/open`, {}, testInstanceOpeningSchema);
}

/** Where a Built instance's file downloads from, behind sign-in: a Download link's href. */
export function testBuildFileAddress(instanceId: string, name: string): string {
  return `${API_PATH}/test-instances/${instanceId}/files/${encodeURIComponent(name)}`;
}

/**
 * A link a phone opens without sign-in, for this one file and an hour, at the address the page was
 * opened at; or, opened at localhost, that it needs The Office's LAN address instead.
 */
export function linkTestBuildFile(instanceId: string, name: string): Promise<TestBuildFileLink> {
  return sendToApi(
    "POST",
    `/test-instances/${instanceId}/files/${encodeURIComponent(name)}/link`,
    {},
    testBuildFileLinkSchema,
  );
}

/** The masked log from byte `from` on, with the offset to read on from and the instance's state. */
export function readTestInstanceLog(
  instanceId: string,
  from: number,
  signal?: AbortSignal,
): Promise<TestInstanceLog> {
  return getFromApi(
    `/test-instances/${instanceId}/log?from=${from}`,
    testInstanceLogSchema,
    signal,
  );
}

export function changeTestInstanceSettings(
  settings: TestInstanceSettings,
): Promise<TestInstanceSettings> {
  return sendToApi("PUT", "/settings/test-instances", settings, testInstanceSettingsSchema);
}

/** The event type the Log window also hears, to read on at once. */
export const TEST_INSTANCE_CHANGED = "test-instance.changed";

export const testInstanceEventInvalidations: Readonly<
  Record<TestInstanceWebEvent["type"], EventInvalidations[string]>
> = {
  [TEST_INSTANCE_CHANGED]: (event) => {
    const parsed = testInstanceWebEventSchema.parse(event);
    return parsed.type === "test-instance.changed"
      ? [testInstanceQueries.ofInitiative(parsed.initiativeId).queryKey]
      : [TEST_INSTANCES];
  },
  "test-instance-settings.changed": () => [SETTINGS],
};

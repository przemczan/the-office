import { randomUUID } from "node:crypto";
import { EventBus } from "../../platform/events/event-bus.js";
import { OfficeDataDirectory } from "../../platform/office-data/office-data-directory.js";
import { ManualSchedule } from "../../platform/schedule/schedule.fixtures.js";
import type { HostedServices } from "../run-environments/index.js";
import { InstanceFiles } from "./application/instance-files.js";
import { RunningTestInstances } from "./application/running-test-instances.js";
import { TestBuildLinks } from "./application/test-build-links.js";
import { TestBuildRetention } from "./application/test-build-retention.js";
import { OfficePort, TestInstanceLimits } from "./application/test-instance-limits.js";
import { TestInstances } from "./application/test-instances.js";
import type { LaunchedBy, TestInstance } from "./domain/test-instance.js";
import { InitiativesForTests } from "./ports/initiatives.fixtures.js";
import {
  ProjectTestTargetsForTests,
  type ProjectForTests,
  type TargetForTests,
} from "./ports/project-test-targets.fixtures.js";
import { TestInstanceRepositoryForTests } from "./ports/test-instance-repository.fixtures.js";
import { TestInstanceSettingsForTests } from "./ports/test-instance-settings-store.fixtures.js";

/** The Office's own port in the testbed, outside the default Proxy ports. */
export const TESTBED_OFFICE_PORT = 4392;

export const ANN: LaunchedBy = { kind: "user", user: { userId: "user-ann", name: "Ann Lee" } };

/** A Hosted target's Secret variable's value, which the log shows only masked. */
export const TARGET_SECRET = "target-s3cret-value";
/** The Project's own Secret variable's value, which no instance gets. */
export const PROJECT_SECRET = "project-s3cret-value";

/** A branch tip with a valid run environment definition and the target's entry point. */
export const BRANCH_FILES: Readonly<Record<string, string>> = {
  ".devcontainer/devcontainer.json": `{ "dockerComposeFile": "compose.yaml", "service": "app", "overrideCommand": true }`,
  ".devcontainer/compose.yaml":
    "services:\n  app:\n    image: node:22\n  postgres:\n    image: postgres:17\n    volumes:\n      - data:/var/lib/postgresql/data\nvolumes:\n  data: {}\n",
  "package-lock.json": '{ "lockfileVersion": 3 }',
  "scripts/start.sh": "#!/bin/sh\nexec node server.js\n",
};

export const WEB_TARGET: TargetForTests = {
  key: "web",
  name: "Web app",
  kind: "hosted",
  entryPoint: { kind: "repository-file", path: "scripts/start.sh", arguments: ["--port", "3000"] },
  port: 3000,
  variables: [{ name: "MODE", value: "test" }],
  secretVariables: [{ name: "API_TOKEN", value: TARGET_SECRET }],
};

/** A Build to install target's Secret variable's value, which the log shows only masked. */
export const BUILD_SECRET = "build-s1gning-value";

/** Where the Build to install target's APKs land in the checkout. */
export const APK_PATTERN = "app/build/outputs/apk/**/*.apk";

export const BUILD_TARGET: TargetForTests = {
  key: "android",
  name: "Android app",
  kind: "build-to-install",
  entryPoint: { kind: "gradle-task", task: "assembleDebug", arguments: [] },
  outputPatterns: [APK_PATTERN],
  variables: [{ name: "FLAVOUR", value: "debug" }],
  secretVariables: [{ name: "SIGNING_TOKEN", value: BUILD_SECRET }],
};

/**
 * Test instances wired by hand over a Run environments testbed's `HostedServices` (Run
 * environments' `runEnvironmentsTestbed`, which a test makes, on the same Office data directory),
 * with Work's and Projects' records in memory, a ManualSchedule and an Initiative "Checkout" active
 * with a branch in the Project `shop`.
 */
export interface TestInstancesTestbed {
  readonly instances: TestInstances;
  readonly running: RunningTestInstances;
  readonly limits: TestInstanceLimits;
  readonly files: InstanceFiles;
  readonly retention: TestBuildRetention;
  readonly links: TestBuildLinks;
  readonly repository: TestInstanceRepositoryForTests;
  readonly settings: TestInstanceSettingsForTests;
  readonly initiatives: InitiativesForTests;
  readonly projects: ProjectTestTargetsForTests;
  readonly schedule: ManualSchedule;
  readonly events: EventBus;
  readonly officeData: OfficeDataDirectory;
  readonly initiativeId: string;
  readonly project: ProjectForTests;
  /** Launches the web target on the Initiative and waits until it is Running or Failed. */
  launchAndSettle(): Promise<TestInstance>;
  /** Launches the Build to install target on the Initiative and waits until it is Built or Failed. */
  buildAndSettle(): Promise<TestInstance>;
}

export function testInstancesTestbed(
  hostedServices: HostedServices,
  /** The Office data directory the Run environments testbed uses. */
  officeDataPath: string,
): TestInstancesTestbed {
  const officeData = new OfficeDataDirectory(officeDataPath);
  const schedule = new ManualSchedule();
  schedule.setTime(new Date("2003-04-05T10:00:00Z"));
  const events = new EventBus();
  const repository = new TestInstanceRepositoryForTests();
  const settings = new TestInstanceSettingsForTests();
  const initiatives = new InitiativesForTests();
  const projects = new ProjectTestTargetsForTests();
  const files = new InstanceFiles(officeData);
  const running = new RunningTestInstances(schedule, settings);
  const retention = new TestBuildRetention(repository, initiatives, files, schedule, events);
  const links = new TestBuildLinks(officeData, schedule);
  const instances = new TestInstances(
    repository,
    settings,
    initiatives,
    projects,
    hostedServices,
    running,
    files,
    schedule,
    events,
    new OfficePort(TESTBED_OFFICE_PORT),
    retention,
  );
  instances.onModuleInit();
  const limits = new TestInstanceLimits(settings, new OfficePort(TESTBED_OFFICE_PORT), events);
  const initiativeId = randomUUID();
  initiatives.put({
    id: initiativeId,
    name: "Checkout",
    state: "active",
    endedAt: undefined,
    branches: [{ projectId: "shop", branch: "initiative/checkout" }],
  });
  const project: ProjectForTests = {
    id: "shop",
    runEnvironmentOn: true,
    targets: [WEB_TARGET, BUILD_TARGET],
    files: { ...BRANCH_FILES },
    commit: "c0ffee0000000000000000000000000000000001",
    entryPointProblems: [],
    installVariables: [{ name: "DEPLOY_KEY", value: PROJECT_SECRET, secret: true }],
  };
  projects.put(project);
  return {
    instances,
    running,
    limits,
    files,
    retention,
    links,
    repository,
    settings,
    initiatives,
    projects,
    schedule,
    events,
    officeData,
    initiativeId,
    project,
    async launchAndSettle() {
      const launched = await instances.launch(
        initiativeId,
        { projectId: "shop", targetKey: "web" },
        ANN,
      );
      await instances.settled();
      return instances.read(launched.id);
    },
    async buildAndSettle() {
      const launched = await instances.launch(
        initiativeId,
        { projectId: "shop", targetKey: "android" },
        ANN,
      );
      await instances.settled();
      return instances.read(launched.id);
    },
  };
}

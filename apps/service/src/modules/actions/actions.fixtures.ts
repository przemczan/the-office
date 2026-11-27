import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DomainEvent } from "../../platform/events/domain-event.js";
import { EventBus } from "../../platform/events/event-bus.js";
import { BusyWork } from "../busy-work/index.js";
import { ManualSchedule } from "../../platform/schedule/schedule.fixtures.js";
import { OfficeTestInstance } from "../../platform/test-instance/office-test-instance.js";
import { ActionLimits } from "./application/action-limits.js";
import { ActionRunLogs } from "./application/action-run-logs.js";
import { ActionRunReactions } from "./application/action-run-reactions.js";
import { ActionRunRecords } from "./application/action-run-records.js";
import { ActionRuns } from "./application/action-runs.js";
import { CommandRuns } from "./application/command-runs.js";
import { RunsInBackground } from "./application/runs-in-background.js";
import { WorkflowRuns } from "./application/workflow-runs.js";
import type { ActionRunUser } from "./domain/action-run.js";
import {
  ActionDevicesForTests,
  ActionProjectsForTests,
  ActionRunRepositoryForTests,
  ActionRunSignalsForTests,
  ActionSettingsForTests,
  ActionSourcesForTests,
  ActionTestInstancesForTests,
  ActionWorkflowHostForTests,
  type ProjectForTests,
} from "./ports/actions-ports.fixtures.js";
import { CommandRunEnvironments } from "./ports/command-run-environments.js";

export const ANN: ActionRunUser = { userId: "user-ann", name: "Ann Lee" };
export const BOB: ActionRunUser = { userId: "user-bob", name: "Bob Kay" };

export const DEPLOY_SECRET = "s3cret-deploy-token";

/** The Shop's phone, which its Action "Install app" holds. */
export const PIXEL_ID = "0b0e0000-0000-4000-8000-000000000009";

export const MAIN_TIP = "c0ffee0000000000000000000000000000000001";
export const FIX_TIP = "f1e0000000000000000000000000000000000002";

/** A `.devcontainer/` a checkout gets: its commands run in the `app` service. */
export const DEFINITION: Readonly<Record<string, string>> = {
  ".devcontainer/devcontainer.json": `{ "dockerComposeFile": "compose.yaml", "service": "app", "overrideCommand": true }`,
  ".devcontainer/compose.yaml": "services:\n  app:\n    image: node:22\n",
};

/** A command run environments stand-in that refuses to run, for tests with the Run environment Off. */
export class NoCommandRunEnvironments extends CommandRunEnvironments {
  readonly stopped: string[] = [];

  run(): never {
    throw new Error("The Run environment is Off in this test.");
  }

  stop(runId: string): Promise<void> {
    this.stopped.push(runId);
    return Promise.resolve();
  }

  sweep(): Promise<void> {
    return Promise.resolve();
  }
}

export interface ActionsTestbed {
  readonly runs: ActionRuns;
  readonly limits: ActionLimits;
  readonly repository: ActionRunRepositoryForTests;
  readonly settings: ActionSettingsForTests;
  readonly projects: ActionProjectsForTests;
  readonly sources: ActionSourcesForTests;
  readonly testInstances: ActionTestInstancesForTests;
  readonly devices: ActionDevicesForTests;
  readonly host: ActionWorkflowHostForTests;
  readonly signals: ActionRunSignalsForTests;
  readonly logs: ActionRunLogs;
  readonly schedule: ManualSchedule;
  readonly events: EventBus;
  readonly busyWork: BusyWork;
  /** Every event published, in order. */
  readonly published: DomainEvent[];
  readonly shop: ProjectForTests;
  readonly taskId: string;
  readonly initiativeId: string;
  /** Where the checkouts and logs go. */
  readonly folder: string;
}

/**
 * Action runs wired by hand over stand-ins of Projects, Work, Test instances and the code host, a
 * ManualSchedule, and the command run environments given (Run environments' own over a scripted
 * runtime, or none); the Project `shop` with an Action of each kind, a Task with a branch and an
 * active Initiative with one.
 */
export async function actionsTestbed(
  environments: CommandRunEnvironments = new NoCommandRunEnvironments(),
  officeTestInstance?: OfficeTestInstance,
): Promise<ActionsTestbed> {
  const folder = await mkdtemp(join(tmpdir(), "office-action-runs-"));
  const schedule = new ManualSchedule();
  schedule.setTime(new Date("2003-04-05T10:00:00Z"));
  const events = new EventBus();
  const published: DomainEvent[] = [];
  events.subscribeToEveryEvent((event) => {
    published.push(event);
  });
  const repository = new ActionRunRepositoryForTests();
  const settings = new ActionSettingsForTests();
  const projects = new ActionProjectsForTests(folder);
  const sources = new ActionSourcesForTests();
  const testInstances = new ActionTestInstancesForTests();
  const devices = new ActionDevicesForTests();
  const host = new ActionWorkflowHostForTests(() => schedule.now());
  const signals = new ActionRunSignalsForTests();
  const background = new RunsInBackground();
  const logs = new ActionRunLogs(projects);
  const records = new ActionRunRecords(repository, logs, projects, events);
  const busyWork = new BusyWork(events);
  const commandRuns = new CommandRuns(
    projects,
    environments,
    records,
    logs,
    schedule,
    background,
    busyWork,
    devices,
  );
  const workflowRuns = new WorkflowRuns(host, repository, records, logs, schedule, background);
  const runs = new ActionRuns(
    repository,
    settings,
    projects,
    sources,
    testInstances,
    devices,
    commandRuns,
    workflowRuns,
    records,
    logs,
    schedule,
    background,
    officeTestInstance,
  );
  runs.onModuleInit();
  new ActionRunReactions(signals, runs, projects, background).onModuleInit();
  const limits = new ActionLimits(settings, events);

  const taskId = randomUUID();
  const initiativeId = randomUUID();
  const shop: ProjectForTests = {
    project: {
      id: "shop",
      name: "Shop",
      baseBranch: "main",
      runEnvironmentOn: false,
      actionsOn: true,
    },
    actions: [
      {
        key: "build-web",
        name: "Build web",
        leavesTheWorkstation: false,
        kind: "project-command",
        settings: {
          commandKey: "build-web",
          commandsBefore: ["install"],
          timeLimitMinutes: null,
          projectDeviceId: null,
        },
      },
      {
        key: "lint",
        name: "Lint",
        leavesTheWorkstation: false,
        kind: "project-command",
        settings: {
          commandKey: "lint",
          commandsBefore: [],
          timeLimitMinutes: 5,
          projectDeviceId: null,
        },
      },
      {
        key: "deploy",
        name: "Deploy",
        leavesTheWorkstation: true,
        kind: "project-command",
        settings: {
          commandKey: "deploy",
          commandsBefore: [],
          timeLimitMinutes: null,
          projectDeviceId: null,
        },
      },
      {
        key: "install-app",
        name: "Install app",
        leavesTheWorkstation: false,
        kind: "project-command",
        settings: {
          commandKey: "install-app",
          commandsBefore: [],
          timeLimitMinutes: null,
          projectDeviceId: PIXEL_ID,
        },
      },
      {
        key: "install-phone",
        name: "Install on my phone",
        leavesTheWorkstation: false,
        kind: "test-target",
        settings: { targetKey: "android" },
      },
      {
        key: "release",
        name: "Release",
        leavesTheWorkstation: true,
        kind: "workflow",
        settings: { file: "release.yml", inputs: { dry_run: "false" } },
      },
      {
        key: "nightly",
        name: "Nightly",
        leavesTheWorkstation: false,
        kind: "workflow",
        settings: { file: "nightly.yml", inputs: {} },
      },
    ],
    commands: [
      { key: "install", name: "Install", commandLine: "npm ci" },
      { key: "build-web", name: "Build web", commandLine: "npm run build" },
      { key: "lint", name: "Lint", commandLine: "npm run lint" },
      { key: "deploy", name: "Deploy", commandLine: "./deploy.sh" },
      { key: "install-app", name: "Install app", commandLine: "adb install app.apk" },
    ],
    targetKeys: ["android"],
    branches: {
      main: { commit: MAIN_TIP, subject: "Add the cart", files: { ...DEFINITION } },
      "fix-login": { commit: FIX_TIP, subject: "Fix the login", files: { ...DEFINITION } },
      [`office/${taskId}`]: {
        commit: "7a5c000000000000000000000000000000000003",
        subject: "Work on the Task",
        files: { ...DEFINITION },
      },
      "initiative/checkout": {
        commit: "1111000000000000000000000000000000000004",
        subject: "The Initiative's work",
        files: { ...DEFINITION },
      },
    },
    remoteBranches: ["main", "fix-login"],
    secret: { name: "DEPLOY_TOKEN", value: DEPLOY_SECRET },
  };
  projects.put(shop);
  devices.devices.set(PIXEL_ID, { id: PIXEL_ID, name: "Pixel 9", projectId: "shop" });
  sources.tasks.set(taskId, {
    id: taskId,
    title: "Fix the cart",
    projectId: "shop",
    ended: false,
    branch: `office/${taskId}`,
  });
  sources.initiatives.set(initiativeId, {
    id: initiativeId,
    name: "Checkout",
    active: true,
    branches: [{ projectId: "shop", branch: "initiative/checkout" }],
  });
  return {
    runs,
    limits,
    repository,
    settings,
    projects,
    sources,
    testInstances,
    devices,
    host,
    signals,
    logs,
    schedule,
    events,
    busyWork,
    published,
    shop,
    taskId,
    initiativeId,
    folder,
  };
}

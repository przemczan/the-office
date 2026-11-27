import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { OfficeDataModule } from "../../../../platform/office-data/office-data.module.js";
import { TelemetryModule } from "../../../../platform/telemetry/telemetry.module.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { GitHubModule } from "../../../github/index.js";
import { PipelineLibrary, PipelineLibraryModule } from "../../../pipelines/index.js";
import {
  ProjectActions,
  ProjectService,
  ProjectSettingChanges,
  ProjectsModule,
  RunEnvironmentSwitchRegistry,
  TestTargets,
} from "../../../projects/index.js";
import {
  createTemporaryRepository,
  REAL_GIT_TEST,
  type TemporaryRepository,
} from "../../../projects/index.fixtures.js";
import { RunEnvironmentsModule } from "../../../run-environments/index.js";
import {
  KnownPeopleForTests,
  KnownPeopleForTestsModule,
  ScriptedContainerRuntime,
} from "../../../run-environments/index.fixtures.js";
import { TaskService } from "../../../work/index.js";
import { ownProjectsQueue, workModuleForTests } from "../../../work/index.fixtures.js";
import { BY_NINA, runOf, SECRET_VALUE, toolsOn } from "./project-setting-office-tools.fixtures.js";

// The tool over the real Projects and Run environments, each change recorded as Nina's on her Task.

let repository: TemporaryRepository;
let app: INestApplication;
let projectId: string;

beforeEach(async () => {
  repository = await createTemporaryRepository();
  const projects = ProjectsModule.register({
    imports: [PipelineLibraryModule, GitHubModule.register()],
    knownPipelines: PipelineLibrary,
  });
  const work = workModuleForTests();
  ({ app } = await startTestApplication({
    database: true,
    overrides: [ownProjectsQueue()],
    imports: [
      EventsModule,
      EventStreamModule,
      TelemetryModule,
      OfficeDataModule.forRoot(`${repository.folder}/office-data`),
      projects,
      work,
      RunEnvironmentsModule.register({
        imports: [work, projects, KnownPeopleForTestsModule],
        knownTasks: TaskService,
        knownPeople: KnownPeopleForTests,
        containerRuntime: new ScriptedContainerRuntime(),
      }),
    ],
  }));
  const project = await app.get(ProjectService, { strict: false }).add({
    name: `Shop ${randomUUID().slice(0, 8)}`,
    path: repository.path,
    baseBranch: "main",
    mark: { label: "SH", colour: "teal" },
    installCommand: "npm ci",
    commands: ["build", "lint", "test"].map((key) => ({
      key,
      name: key,
      kind: key as "build" | "lint" | "test",
      commandLine: `npm run ${key}`,
      rerunCommandLine: "",
    })),
    installInputs: [],
    publishingMode: "merge",
    defaultPipeline: "full",
  });
  projectId = project.id;
}, REAL_GIT_TEST.timeout);

afterEach(async () => {
  await app.close();
  await repository.remove();
});

function tools() {
  return toolsOn({
    projects: app.get(ProjectService, { strict: false }),
    testTargets: app.get(TestTargets, { strict: false }),
    actions: app.get(ProjectActions, { strict: false }),
    runEnvironments: app.get(RunEnvironmentSwitchRegistry, { strict: false }),
  });
}

async function latest(limit = 1) {
  return app.get(ProjectSettingChanges, { strict: false }).latestOf(projectId, limit);
}

const E2E = {
  key: "e2e",
  name: "End to end",
  kind: "test",
  commandLine: "npm run e2e",
  rerunCommandLine: "",
};

const WEB = {
  key: "web",
  name: "Web",
  kind: "hosted",
  entryPoint: { kind: "repository-file", path: "src/index.ts", arguments: [] },
  port: 5173,
  secretVariables: [{ name: "STRIPE_KEY" }],
};

const BUILD_APP = {
  key: "build-app",
  name: "Build the app",
  kind: "project-command",
  settings: { commandKey: "build" },
};

describe("the change_project_settings tool, over Projects", REAL_GIT_TEST, () => {
  it("applies a whole setup in one call, each section recorded as the person's on their Task, no Secret variable's value anywhere", async () => {
    const projects = app.get(ProjectService, { strict: false });
    await projects.changeEnvironment(
      projectId,
      {
        set: [{ name: "API_TOKEN", value: SECRET_VALUE, secret: true }],
        unset: [],
        prependPath: [],
      },
      { kind: "user", user: { userId: "user-ann", name: "Ann" } },
    );
    const { tool } = tools();
    const setup = {
      project: projectId,
      environmentVariables: { variables: [{ name: "GREETING", value: "hello" }] },
      install: "npm install",
      commands: { add: [E2E] },
      testTargets: { targets: [WEB] },
      actions: { actions: [BUILD_APP] },
      runEnvironment: "on",
      why: "Set it up.",
    };

    const result = await runOf(tool, setup);

    expect(result).toEqual({
      text: expect.stringMatching(/^Changed: /),
      isError: false,
    });
    const records = await latest(5);
    expect(records.map(({ setting }) => setting)).toEqual([
      "run-environment",
      "actions",
      "test-targets",
      "commands",
      "environment",
    ]);
    for (const record of records) expect(record.by).toEqual(BY_NINA);
    expect(JSON.stringify(records)).not.toContain(SECRET_VALUE);
    const project = await projects.read(projectId);
    expect(project.installCommand).toBe("npm install");
    expect(project.commands.map(({ key }) => key)).toEqual(["build", "lint", "test", "e2e"]);
    expect(project.runEnvironment).toBe("on");
    expect(project.environment.set).toEqual([
      { name: "API_TOKEN", value: SECRET_VALUE, secret: true },
      { name: "GREETING", value: "hello", secret: false },
    ]);
    const [web] = await app.get(TestTargets, { strict: false }).list(projectId);
    expect(web).toMatchObject({ key: "web", setBy: {} });
    expect(
      web && "secretVariables" in web ? web.secretVariables.map(({ name }) => name) : [],
    ).toEqual(["STRIPE_KEY"]);
  });

  it("rotates a Secret variable's value, recorded by its name only", async () => {
    const projects = app.get(ProjectService, { strict: false });
    await projects.changeEnvironment(
      projectId,
      {
        set: [{ name: "API_TOKEN", value: SECRET_VALUE, secret: true }],
        unset: [],
        prependPath: [],
      },
      { kind: "user", user: { userId: "user-ann", name: "Ann" } },
    );
    const { tool } = tools();

    const result = await runOf(tool, {
      project: projectId,
      environmentVariables: {
        variables: [{ name: "API_TOKEN", value: "rotated-value", secret: true }],
      },
      why: "Rotated.",
    });

    expect(result.isError).toBe(false);
    const [record] = await latest(1);
    expect(record?.by).toEqual(BY_NINA);
    expect(JSON.stringify(record)).not.toContain("rotated-value");
    expect((await projects.read(projectId)).environment.set).toEqual([
      { name: "API_TOKEN", value: "rotated-value", secret: true },
    ]);
  });

  it("turns Run environment On after the sections before it, with no definition on the base branch", async () => {
    const { tool } = tools();

    const result = await runOf(tool, {
      project: projectId,
      install: "npm install",
      runEnvironment: "on",
      why: "Faster.",
    });

    expect(result).toEqual({ text: expect.stringMatching(/^Changed: /), isError: false });
    expect((await latest(2)).map(({ setting, by }) => [setting, by])).toEqual([
      ["run-environment", BY_NINA],
      ["commands", BY_NINA],
    ]);
    expect((await app.get(ProjectService, { strict: false }).read(projectId)).runEnvironment).toBe(
      "on",
    );
  });
});

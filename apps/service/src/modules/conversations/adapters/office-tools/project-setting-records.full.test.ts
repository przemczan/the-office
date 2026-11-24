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
import { ScriptedContainerRuntime } from "../../../run-environments/index.fixtures.js";
import { TaskService } from "../../../work/index.js";
import { ownProjectsQueue, workModuleForTests } from "../../../work/index.fixtures.js";
import {
  CHANGE_ACTIONS_TOOL,
  CHANGE_ENVIRONMENT_VARIABLES_TOOL,
  CHANGE_PROJECT_COMMANDS_TOOL,
  CHANGE_RUN_ENVIRONMENT_TOOL,
  CHANGE_TEST_TARGETS_TOOL,
} from "../../domain/session-instructions.js";
import { BY_NINA, runOf, SECRET_VALUE, toolsOn } from "./project-setting-office-tools.fixtures.js";

// The tools over the real Projects and Run environments, each change recorded as Nina's on her Task.

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
        imports: [work, projects],
        knownTasks: TaskService,
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

async function latest() {
  const [change] = await app.get(ProjectSettingChanges, { strict: false }).latestOf(projectId, 1);
  return change;
}

describe("the Project setting tools, over Projects", REAL_GIT_TEST, () => {
  it("turns Run environment Off, recorded as the person's on their Task, and refuses On without a definition", async () => {
    const { tool } = tools();

    const off = await runOf(tool(CHANGE_RUN_ENVIRONMENT_TOOL), {
      project: projectId,
      runEnvironment: "off",
      why: "No Docker here.",
    });
    const on = await runOf(tool(CHANGE_RUN_ENVIRONMENT_TOOL), {
      project: projectId,
      runEnvironment: "on",
      why: "Faster.",
    });

    expect(off.isError).toBe(false);
    expect(await latest()).toMatchObject({ setting: "run-environment", by: BY_NINA });
    expect(on).toEqual({
      text: "Run environment can't be On: the base branch main has no valid .devcontainer/. The repository has no .devcontainer/devcontainer.json.",
      isError: true,
    });
    expect((await app.get(ProjectService, { strict: false }).read(projectId)).runEnvironment).toBe(
      "off",
    );
  });

  it("changes the commands, recorded as the person's", async () => {
    const { tool } = tools();

    const result = await runOf(tool(CHANGE_PROJECT_COMMANDS_TOOL), {
      project: projectId,
      install: "npm install",
      commands: {
        add: [
          {
            key: "e2e",
            name: "End to end",
            kind: "test",
            commandLine: "npm run e2e",
            rerunCommandLine: "",
          },
        ],
      },
      why: "Tests.",
    });

    expect(result.isError).toBe(false);
    expect(await latest()).toMatchObject({ setting: "commands", by: BY_NINA });
    const project = await app.get(ProjectService, { strict: false }).read(projectId);
    expect(project.installCommand).toBe("npm install");
    expect(project.commands.map(({ key }) => key)).toEqual(["build", "lint", "test", "e2e"]);
  });

  it("changes the plain Environment variables, keeping the Secret variables' values and never recording one", async () => {
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

    const result = await runOf(tool(CHANGE_ENVIRONMENT_VARIABLES_TOOL), {
      project: projectId,
      variables: [{ name: "GREETING", value: "hello" }],
      why: "A greeting.",
    });

    expect(result.isError).toBe(false);
    const change = await latest();
    expect(change).toMatchObject({ setting: "environment", by: BY_NINA });
    expect(JSON.stringify(change)).not.toContain(SECRET_VALUE);
    expect((await projects.read(projectId)).environment.set).toEqual([
      { name: "API_TOKEN", value: SECRET_VALUE, secret: true },
      { name: "GREETING", value: "hello", secret: false },
    ]);
  });

  it("adds a test target and an Action, each recorded as the person's, with no user as the setter", async () => {
    const { tool } = tools();

    const target = await runOf(tool(CHANGE_TEST_TARGETS_TOOL), {
      project: projectId,
      targets: [
        {
          key: "web",
          name: "Web",
          kind: "hosted",
          entryPoint: { kind: "repository-file", path: "src/index.ts", arguments: [] },
          port: 5173,
        },
      ],
      why: "A web app to try.",
    });
    expect(target.isError).toBe(false);
    expect(await latest()).toMatchObject({ setting: "test-targets", by: BY_NINA });
    const [web] = await app.get(TestTargets, { strict: false }).list(projectId);
    expect(web).toMatchObject({ key: "web", setBy: {} });

    const action = await runOf(tool(CHANGE_ACTIONS_TOOL), {
      project: projectId,
      actions: [
        {
          key: "build-app",
          name: "Build the app",
          kind: "project-command",
          settings: { commandKey: "build" },
        },
      ],
      why: "Handy.",
    });
    expect(action.isError).toBe(false);
    expect(await latest()).toMatchObject({ setting: "actions", by: BY_NINA });
  });
});

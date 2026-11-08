import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import {
  projectRefusalSchema,
  projectRunEnvironmentSchema,
  projectSchema,
  type NewProject,
  type Project,
  type ProjectRunEnvironment,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { OfficeDataModule } from "../../../../platform/office-data/office-data.module.js";
import { TelemetryModule } from "../../../../platform/telemetry/telemetry.module.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { GitHubModule } from "../../../github/index.js";
import { PipelineLibrary, PipelineLibraryModule } from "../../../pipelines/index.js";
import { ProjectsModule } from "../../../projects/index.js";
import {
  createTemporaryRepository,
  gitIn,
  REAL_GIT_TEST,
  type TemporaryRepository,
} from "../../../projects/index.fixtures.js";
import { TaskService, TaskStateChanged } from "../../../work/index.js";
import { ownProjectsQueue, workModuleForTests } from "../../../work/index.fixtures.js";
import { ScriptedContainerRuntime } from "../../index.fixtures.js";
import { RunEnvironmentsModule } from "../../run-environments.module.js";

const VALID_DEFINITION = {
  ".devcontainer/devcontainer.json": '{ "dockerComposeFile": "compose.yaml", "service": "app" }',
  ".devcontainer/compose.yaml": "services:\n  app:\n    image: node:22\n",
};

const INVALID_DEFINITION = {
  ".devcontainer/devcontainer.json": '{ "dockerComposeFile": "compose.yaml" }',
  ".devcontainer/compose.yaml": "services:\n  app:\n    image: node:22\n",
};

const NO_SERVICE =
  'devcontainer.json names no service: set "service" to the one the checks run in.';

let repository: TemporaryRepository;
let app: INestApplication;
let url: string;
let project: Project;

beforeEach(async () => {
  repository = await createTemporaryRepository();
  const projects = ProjectsModule.register({
    imports: [PipelineLibraryModule, GitHubModule.register()],
    knownPipelines: PipelineLibrary,
  });
  const work = workModuleForTests();
  ({ app, url } = await startTestApplication({
    database: true,
    overrides: [ownProjectsQueue()],
    imports: [
      EventsModule,
      EventStreamModule,
      TelemetryModule,
      OfficeDataModule.forRoot(join(repository.folder, "office-data")),
      projects,
      work,
      RunEnvironmentsModule.register({
        imports: [work, projects],
        knownTasks: TaskService,
        containerRuntime: new ScriptedContainerRuntime(),
      }),
    ],
  }));
  const newProject: NewProject = {
    name: `Shop ${randomUUID().slice(0, 8)}`,
    path: repository.path,
    baseBranch: "main",
    mark: { label: "SH", colour: "teal" },
    commands: { install: "npm ci", build: "npm run build", lint: "npm run lint", test: "npm test" },
    installInputs: [],
    publishingMode: "merge",
    defaultPipeline: "full",
  };
  project = projectSchema.parse(await (await send("POST", "/projects", newProject)).json());
});

afterEach(async () => {
  await app.close();
  await repository.remove();
});

function send(method: "GET" | "PUT" | "POST", path: string, body?: unknown): Promise<Response> {
  return fetch(`${url}/api${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
}

async function runEnvironmentOf(response: Response): Promise<ProjectRunEnvironment> {
  expect(response.status).toBeLessThan(300);
  return projectRunEnvironmentSchema.parse(await response.json());
}

const read = async (): Promise<ProjectRunEnvironment> =>
  runEnvironmentOf(await send("GET", `/projects/${project.id}/run-environment`));

const setUp = async (): Promise<ProjectRunEnvironment> =>
  runEnvironmentOf(await send("POST", `/projects/${project.id}/run-environment/set-up`));

/** Commits the files on `branch`, made from main when it isn't there yet, and goes back to main. */
async function commitFiles(branch: string, files: Readonly<Record<string, string>>): Promise<void> {
  if (branch !== "main") gitIn(repository.path, "checkout", "--quiet", "-B", branch, "main");
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(repository.path, path)), { recursive: true });
    await writeFile(join(repository.path, path), text);
  }
  gitIn(repository.path, "add", ".");
  gitIn(repository.path, "commit", "--quiet", "--message", `Files on ${branch}`);
  gitIn(repository.path, "checkout", "--quiet", "main");
}

describe("GET /projects/:id/run-environment", REAL_GIT_TEST, () => {
  it("starts every Project at Not decided yet, with no definition found", async () => {
    expect(project.runEnvironment).toBe("not-decided");
    expect(await read()).toEqual({
      runEnvironment: "not-decided",
      definition: { state: "not-found" },
      setUpProblems: [],
      setUpTask: null,
    });
  });

  it("lists each problem of a definition that isn't valid", async () => {
    await commitFiles("main", INVALID_DEFINITION);

    expect((await read()).definition).toEqual({ state: "not-valid", problems: [NO_SERVICE] });
  });

  it("answers 404 for a Project that doesn't exist", async () => {
    expect((await send("GET", "/projects/no-such-project/run-environment")).status).toBe(404);
  });
});

describe("PUT /projects/:id/run-environment", REAL_GIT_TEST, () => {
  it("refuses On without a valid definition on the base branch, saying why", async () => {
    const response = await send("PUT", `/projects/${project.id}/run-environment`, {
      runEnvironment: "on",
    });

    expect(response.status).toBe(422);
    expect(projectRefusalSchema.parse(await response.json()).reasons).toEqual([
      "Run environment can't be On: the base branch main has no valid .devcontainer/.",
      "The repository has no .devcontainer/devcontainer.json.",
    ]);
    expect((await read()).runEnvironment).toBe("not-decided");
  });

  it("turns On with a valid definition, and always takes Off", async () => {
    await commitFiles("main", VALID_DEFINITION);

    const on = await send("PUT", `/projects/${project.id}/run-environment`, {
      runEnvironment: "on",
    });
    expect((await runEnvironmentOf(on)).runEnvironment).toBe("on");

    await commitFiles("main", INVALID_DEFINITION);
    const off = await send("PUT", `/projects/${project.id}/run-environment`, {
      runEnvironment: "off",
    });
    expect((await runEnvironmentOf(off)).runEnvironment).toBe("off");
    const saved = projectSchema.parse(await (await send("GET", `/projects/${project.id}`)).json());
    expect(saved.runEnvironment).toBe("off");
  });

  it("refuses Not decided yet, which only the start has", async () => {
    const response = await send("PUT", `/projects/${project.id}/run-environment`, {
      runEnvironment: "not-decided",
    });

    expect(response.status).toBe(400);
  });
});

describe("POST /projects/:id/run-environment/set-up", REAL_GIT_TEST, () => {
  it("turns On at once with a valid definition on the base branch, adding no Task", async () => {
    await commitFiles("main", VALID_DEFINITION);

    expect(await setUp()).toEqual({
      runEnvironment: "on",
      definition: { state: "valid" },
      setUpProblems: [],
      setUpTask: null,
    });
  });

  it("adds one set-up Task without one, which asking again answers", async () => {
    const first = await setUp();
    const second = await setUp();

    expect(first.runEnvironment).toBe("not-decided");
    expect(first.setUpTask).toEqual({
      id: expect.any(String),
      title: "Set up the run environment",
      state: "ready",
    });
    expect(second.setUpTask).toEqual(first.setUpTask);
    const [againAtOnce, andAgain] = await Promise.all([setUp(), setUp()]);
    expect(againAtOnce.setUpTask?.id).toBe(first.setUpTask?.id);
    expect(andAgain.setUpTask?.id).toBe(first.setUpTask?.id);
    expect((await read()).setUpTask).toEqual(first.setUpTask);
  });
});

/** As Pipelines moves a started Task into Done or Dropped. */
async function finish(taskId: string, to: "done" | "dropped"): Promise<void> {
  await app.get(EventBus).publish(new TaskStateChanged(taskId, "in-progress", to));
}

describe("a set-up Task that ends", REAL_GIT_TEST, () => {
  it("turns On when Done with a valid definition on its own branch", async () => {
    const { setUpTask } = await setUp();
    const taskId = setUpTask?.id ?? "";
    await commitFiles(`office/${taskId}`, VALID_DEFINITION);

    await finish(taskId, "done");

    expect(await read()).toMatchObject({ runEnvironment: "on", setUpProblems: [] });
  });

  it("leaves the setting as it was when Done with an invalid definition, saying why", async () => {
    await send("PUT", `/projects/${project.id}/run-environment`, { runEnvironment: "off" });
    const { setUpTask } = await setUp();
    const taskId = setUpTask?.id ?? "";
    await commitFiles(`office/${taskId}`, INVALID_DEFINITION);

    await finish(taskId, "done");

    expect(await read()).toMatchObject({ runEnvironment: "off", setUpProblems: [NO_SERVICE] });
  });

  it("changes nothing when Dropped", async () => {
    const { setUpTask } = await setUp();
    const taskId = setUpTask?.id ?? "";
    await commitFiles(`office/${taskId}`, VALID_DEFINITION);

    await finish(taskId, "dropped");

    expect(await read()).toMatchObject({ runEnvironment: "not-decided", setUpProblems: [] });
  });
});

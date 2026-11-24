import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import {
  projectListSchema,
  projectSchema,
  runEnvironmentSetUpAnswerSchema,
  type AddProject,
  type Project,
  type ProjectRunEnvironment,
  type RunEnvironmentAnswer,
  type RunEnvironmentSetUpAnswer,
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
import { ProjectsModule, TaskBases } from "../../../projects/index.js";
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
import { newProjectIn, runEnvironmentOf } from "./project-run-environments.controller.fixtures.js";

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
  // Work registers its lookup with its test ports' stand-in, so Projects' own gets one here.
  app
    .select(projects)
    .get(TaskBases, { strict: true })
    .register(async () => ({ kind: "base-branch" }));
  project = await addProject(newProjectIn(repository.path));
});

afterEach(async () => {
  await app.close();
  await repository.remove();
});

async function addProject(request: AddProject): Promise<Project> {
  const response = await send("POST", "/projects", request);
  expect(response.status).toBe(201);
  return projectSchema.parse(await response.json());
}

function send(method: "GET" | "PUT" | "POST", path: string, body?: unknown): Promise<Response> {
  return fetch(`${url}/api${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
}

const read = async (projectId = project.id): Promise<ProjectRunEnvironment> =>
  runEnvironmentOf(await send("GET", `/projects/${projectId}/run-environment`));

const setUpAnswer = async (): Promise<RunEnvironmentSetUpAnswer> => {
  const response = await send("POST", `/projects/${project.id}/run-environment/set-up`);
  expect(response.status).toBeLessThan(300);
  return runEnvironmentSetUpAnswerSchema.parse(await response.json());
};

const setUp = async (): Promise<ProjectRunEnvironment> => (await setUpAnswer()).runEnvironment;

/** Commits the files on `branch`, made from main when it isn't there yet, and goes back to main. */
async function commitFiles(
  branch: string,
  files: Readonly<Record<string, string>>,
  repositoryPath = repository.path,
): Promise<void> {
  if (branch !== "main") gitIn(repositoryPath, "checkout", "--quiet", "-B", branch, "main");
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(repositoryPath, path)), { recursive: true });
    await writeFile(join(repositoryPath, path), text);
  }
  gitIn(repositoryPath, "add", ".");
  gitIn(repositoryPath, "commit", "--quiet", "--message", `Files on ${branch}`);
  gitIn(repositoryPath, "checkout", "--quiet", "main");
}

describe("GET /projects/:id/run-environment", REAL_GIT_TEST, () => {
  it("lists each problem of a definition that isn't valid", async () => {
    await commitFiles("main", INVALID_DEFINITION);

    expect((await read()).definition).toEqual({ state: "not-valid", problems: [NO_SERVICE] });
  });

  it("answers 404 for a Project that doesn't exist", async () => {
    expect((await send("GET", "/projects/no-such-project/run-environment")).status).toBe(404);
  });
});

describe("PUT /projects/:id/run-environment", REAL_GIT_TEST, () => {
  it("refuses a setting other than On or Off", async () => {
    const response = await send("PUT", `/projects/${project.id}/run-environment`, {
      runEnvironment: "not-decided",
    });

    expect(response.status).toBe(400);
  });
});

describe("POST /projects/:id/run-environment/set-up", REAL_GIT_TEST, () => {
  it("turns On at once with a valid definition on the base branch, adding no Task", async () => {
    await commitFiles("main", VALID_DEFINITION);

    expect(await setUpAnswer()).toEqual({
      runEnvironment: {
        runEnvironment: "on",
        definition: { state: "valid" },
        setUpProblems: [],
        setUpTask: null,
      },
      start: null,
    });
  });

  it("makes and starts one set-up Off-board Task without one, which asking again answers", async () => {
    const first = await setUpAnswer();
    const second = await setUpAnswer();

    expect(first.runEnvironment.runEnvironment).toBe("off");
    expect(first.runEnvironment.setUpTask).toEqual({
      id: expect.any(String),
      title: "Set up the run environment",
      state: "in-progress",
    });
    expect(first.start).toMatchObject({
      outcome: "started",
      offBoardTask: {
        taskId: first.runEnvironment.setUpTask?.id,
        kind: "run-environment-setup",
        status: { state: "running" },
      },
    });
    expect(second.start).toMatchObject({
      outcome: "in-flight",
      offBoardTask: { taskId: first.runEnvironment.setUpTask?.id },
    });
    const [againAtOnce, andAgain] = await Promise.all([setUp(), setUp()]);
    expect(againAtOnce.setUpTask?.id).toBe(first.runEnvironment.setUpTask?.id);
    expect(andAgain.setUpTask?.id).toBe(first.runEnvironment.setUpTask?.id);
    expect((await read()).setUpTask).toEqual(first.runEnvironment.setUpTask);
  });
});

describe("POST /projects with the run environment answer", REAL_GIT_TEST, () => {
  let another: TemporaryRepository;

  beforeEach(async () => {
    another = await createTemporaryRepository();
  });

  afterEach(async () => {
    await another.remove();
  });

  const addAnswering = (runEnvironmentAnswer?: RunEnvironmentAnswer): Promise<Project> =>
    addProject({ ...newProjectIn(another.path), runEnvironmentAnswer });

  it("turns On at once with Yes and a valid definition on the base branch", async () => {
    await commitFiles("main", VALID_DEFINITION, another.path);

    const added = await addAnswering("yes");

    expect(added.runEnvironment).toBe("on");
    expect((await read(added.id)).setUpTask).toBeNull();
  });

  it("starts the set-up Task with Yes and no definition, leaving it Off", async () => {
    const added = await addAnswering("yes");

    expect(added.runEnvironment).toBe("off");
    expect((await read(added.id)).setUpTask).toEqual({
      id: expect.any(String),
      title: "Set up the run environment",
      state: "in-progress",
    });
  });

  it("leaves it Off with No, whatever the base branch has", async () => {
    await commitFiles("main", VALID_DEFINITION, another.path);

    const added = await addAnswering("no");

    expect(added.runEnvironment).toBe("off");
    expect(await read(added.id)).toMatchObject({ runEnvironment: "off", setUpTask: null });
  });

  it("leaves it Off with no answer, as with No", async () => {
    await commitFiles("main", VALID_DEFINITION, another.path);

    const added = await addAnswering();

    expect(await read(added.id)).toMatchObject({ runEnvironment: "off", setUpTask: null });
  });

  it("refuses an answer it doesn't know, adding nothing", async () => {
    const response = await send("POST", "/projects", {
      ...newProjectIn(another.path),
      runEnvironmentAnswer: "decide-later",
    });

    expect(response.status).toBe(400);
    const projects = projectListSchema.parse(await (await send("GET", "/projects")).json());
    expect(projects.map(({ path }) => path)).not.toContain(another.path);
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

    expect(await read()).toMatchObject({ runEnvironment: "off", setUpProblems: [] });
  });
});

describe("any other Task that ends", REAL_GIT_TEST, () => {
  it("changes nothing when Done, even with its valid definition on the base branch", async () => {
    const taskId = "7f3c2a10-0d4e-4b7a-9c1e-2f5a6b7c8d9e";
    await commitFiles(`office/${taskId}`, VALID_DEFINITION);
    await commitFiles("main", VALID_DEFINITION);

    await finish(taskId, "done");

    expect(await read()).toMatchObject({ runEnvironment: "off" });
  });
});

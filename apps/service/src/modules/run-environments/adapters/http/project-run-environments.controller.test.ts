import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import {
  projectRefusalSchema,
  projectSchema,
  type AddProject,
  type Project,
  type ProjectRunEnvironment,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
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
import { TaskService } from "../../../work/index.js";
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
  it("starts every Project at Not decided yet, with no definition found", async () => {
    expect(project.runEnvironment).toBe("not-decided");
    expect(await read()).toEqual({
      runEnvironment: "not-decided",
      definition: { state: "not-found" },
      setUpProblems: [],
      setUpTask: null,
    });
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
});

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import {
  projectListSchema,
  projectRefusalSchema,
  projectSchema,
  projectWebEventSchema,
  type NewProject,
  type Project,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { OfficeDataModule } from "../../../../platform/office-data/office-data.module.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import { PipelineLibrary, PipelinesModule } from "../../../pipelines/index.js";
import { ProjectsModule } from "../../projects.module.js";
import {
  createTemporaryRepository,
  type TemporaryRepository,
} from "../git/temporary-repository.fixtures.js";

let repository: TemporaryRepository;
let app: INestApplication;
let url: string;
let published: DomainEvent[];

beforeAll(async () => {
  repository = await createTemporaryRepository();
});

afterAll(async () => {
  await repository.remove();
});

beforeEach(async () => {
  ({ app, url } = await startTestApplication({
    database: true,
    imports: [
      EventsModule,
      EventStreamModule,
      OfficeDataModule.forRoot(join(repository.folder, "office-data")),
      ProjectsModule.register({ imports: [PipelinesModule], knownPipelines: PipelineLibrary }),
    ],
  }));
  published = [];
  app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));
});

afterEach(async () => {
  await app.close();
});

/** A Project of the test's own name, since every test file shares the database. */
function aNewProject(fields: Partial<NewProject> = {}): NewProject {
  return {
    name: `Admin panel ${randomUUID().slice(0, 8)}`,
    path: repository.path,
    baseBranch: "main",
    mark: { label: "AP", colour: "teal" },
    commands: { install: "npm ci", build: "npm run build", lint: "npm run lint", test: "npm test" },
    installInputs: ["package-lock.json"],
    publishingMode: "push-and-pull-request",
    defaultPipeline: "full",
    ...fields,
  };
}

function send(method: "POST" | "PUT", path: string, body: unknown): Promise<Response> {
  return fetch(`${url}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function addProject(fields: Partial<NewProject> = {}): Promise<Project> {
  const response = await send("POST", "/projects", aNewProject(fields));
  expect(response.status).toBe(201);
  return projectSchema.parse(await response.json());
}

/** The events published so far, as the web receives them. */
function webEvents(): unknown[] {
  const forwarding = app.get(WebEventForwarding);
  return published.map((event) => {
    const { occurredAt: _occurredAt, ...webEvent } = projectWebEventSchema.parse(
      forwarding.toWebEvent(event),
    );
    return webEvent;
  });
}

describe("POST /api/projects", () => {
  it("adds a Project with an id from its name and the skills switch on", async () => {
    const newProject = aNewProject({ name: " Admin panel ", baseBranch: " main " });
    const response = await send("POST", "/projects", newProject);

    expect(response.status).toBe(201);
    const project = projectSchema.parse(await response.json());
    expect(project).toMatchObject({
      ...newProject,
      id: expect.stringMatching(/^admin-panel(-\d+)?$/),
      name: "Admin panel",
      baseBranch: "main",
      useProjectSkills: true,
    });
    expect(webEvents()).toEqual([{ type: "project.added", projectId: project.id }]);
  });

  it("keeps the repository's folder without a trailing separator", async () => {
    const project = await addProject({ path: `${repository.path}/src/../` });

    expect(project.path).toBe(repository.path);
  });

  it("refuses a folder that isn't a git repository with git's reason, saving nothing", async () => {
    const response = await send("POST", "/projects", aNewProject({ path: repository.folder }));

    expect(response.status).toBe(422);
    expect(projectRefusalSchema.parse(await response.json()).reasons).toEqual([
      expect.stringMatching(/ is not a git repository: fatal: not a git repository/),
    ]);
    expect(published).toEqual([]);
  });

  it.each<[string, Partial<NewProject>, string]>([
    [
      "a base branch that doesn't exist",
      { baseBranch: "develop" },
      'The repository has no branch "develop".',
    ],
    [
      "a default Pipeline that doesn't exist",
      { defaultPipeline: "nightly" },
      'There is no Pipeline "nightly".',
    ],
  ])("refuses %s with the reason, saving nothing", async (_what, fields, reason) => {
    const response = await send("POST", "/projects", aNewProject(fields));

    expect(response.status).toBe(422);
    expect(projectRefusalSchema.parse(await response.json())).toEqual({
      statusCode: 422,
      message: reason,
      reasons: [reason],
    });
    expect(published).toEqual([]);
  });

  it("answers 400 to a body that breaks the contract", async () => {
    const response = await send("POST", "/projects", { ...aNewProject(), publishingMode: "fax" });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      message: expect.stringContaining("publishingMode"),
    });
  });
});

describe("GET /api/projects", () => {
  it("lists Projects in the order they were added, and reads one", async () => {
    const first = await addProject();
    const second = await addProject();

    const listed = projectListSchema.parse(await (await fetch(`${url}/api/projects`)).json());
    const read = projectSchema.parse(
      await (await fetch(`${url}/api/projects/${second.id}`)).json(),
    );

    expect(listed.filter((project) => [first.id, second.id].includes(project.id))).toEqual([
      first,
      second,
    ]);
    expect(read).toEqual(second);
  });

  it("answers 404 for a Project that doesn't exist", async () => {
    const response = await fetch(`${url}/api/projects/nowhere`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      statusCode: 404,
      message: 'There is no Project "nowhere".',
    });
  });
});

describe("PUT /api/projects/:id/commands/:key", () => {
  it("changes one command and announces it", async () => {
    const project = await addProject();
    published = [];

    const response = await send("PUT", `/projects/${project.id}/commands/test`, {
      commandLine: "npm test -- --run",
    });

    expect(response.status).toBe(200);
    expect(projectSchema.parse(await response.json()).commands).toEqual({
      ...project.commands,
      test: "npm test -- --run",
    });
    expect(webEvents()).toEqual([
      { type: "project.command-changed", projectId: project.id, key: "test" },
    ]);
  });

  it("announces nothing when the command is already that line", async () => {
    const project = await addProject();
    published = [];

    const response = await send("PUT", `/projects/${project.id}/commands/lint`, {
      commandLine: project.commands.lint,
    });

    expect(response.status).toBe(200);
    expect(published).toEqual([]);
  });

  it("refuses an empty command, and a command that isn't one of the four", async () => {
    const project = await addProject();

    const empty = await send("PUT", `/projects/${project.id}/commands/build`, { commandLine: " " });
    const unknown = await send("PUT", `/projects/${project.id}/commands/deploy`, {
      commandLine: "npm run deploy",
    });

    expect(empty.status).toBe(422);
    expect(await empty.json()).toMatchObject({ reasons: ["The build command can't be empty."] });
    expect(unknown.status).toBe(400);
  });
});

describe("PUT /api/projects/:id/install-inputs", () => {
  it("changes the install inputs and announces it", async () => {
    const project = await addProject();
    published = [];

    const response = await send("PUT", `/projects/${project.id}/install-inputs`, {
      installInputs: ["package-lock.json", " apps/web/package.json "],
    });

    expect(projectSchema.parse(await response.json()).installInputs).toEqual([
      "package-lock.json",
      "apps/web/package.json",
    ]);
    expect(webEvents()).toEqual([
      { type: "project.install-inputs-changed", projectId: project.id },
    ]);
  });

  it("refuses a path outside the repository", async () => {
    const project = await addProject();

    const response = await send("PUT", `/projects/${project.id}/install-inputs`, {
      installInputs: ["../package-lock.json"],
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      reasons: ['An install input is a path inside the repository; "../package-lock.json" is not.'],
    });
  });
});

describe("PUT /api/projects/:id/publishing-mode and /default-pipeline", () => {
  it("changes how the Project publishes and the Pipeline new Tasks start from", async () => {
    const project = await addProject();
    published = [];

    await send("PUT", `/projects/${project.id}/publishing-mode`, { publishingMode: "merge" });
    const response = await send("PUT", `/projects/${project.id}/default-pipeline`, {
      defaultPipeline: "quick-fix",
    });

    expect(projectSchema.parse(await response.json())).toMatchObject({
      publishingMode: "merge",
      defaultPipeline: "quick-fix",
    });
    expect(webEvents()).toEqual([
      { type: "project.publishing-mode-changed", projectId: project.id },
      { type: "project.default-pipeline-changed", projectId: project.id },
    ]);
  });

  it("refuses a default Pipeline that doesn't exist", async () => {
    const project = await addProject();

    const response = await send("PUT", `/projects/${project.id}/default-pipeline`, {
      defaultPipeline: "nightly",
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ reasons: ['There is no Pipeline "nightly".'] });
  });
});

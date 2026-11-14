import type { INestApplication } from "@nestjs/common";
import {
  projectListSchema,
  projectRefusalSchema,
  PROJECT_LIMIT_MAX,
  projectSchema,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "../../../../platform/events/event-bus.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import {
  createTemporaryRepository,
  type TemporaryRepository,
} from "../git/temporary-repository.fixtures.js";
import { projectsHttp, startProjectsApplication } from "../../projects.controller.fixtures.js";

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
  ({ app, url } = await startProjectsApplication(repository));
  published = [];
  app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));
});

afterEach(async () => {
  await app.close();
});

const { aNewProject, send, addProject, webEvents } = projectsHttp(() => ({
  app,
  url,
  published,
  repository,
}));

describe("POST /api/projects", () => {
  it("adds a Project with an id from its name, the skills switch on and a Project limit of 1", async () => {
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
      projectLimit: 1,
    });
    expect(webEvents()).toEqual([{ type: "project.added", projectId: project.id }]);
  });

  it("refuses a folder that isn't a git repository with git's reason, saving nothing", async () => {
    const response = await send("POST", "/projects", aNewProject({ path: repository.folder }));

    expect(response.status).toBe(422);
    expect(projectRefusalSchema.parse(await response.json()).reasons).toEqual([
      expect.stringMatching(/ is not a git repository: fatal: not a git repository/),
    ]);
    expect(published).toEqual([]);
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

describe("PUT /api/projects/:id/install-command", () => {
  it("changes install and announces it", async () => {
    const project = await addProject();
    published = [];

    const response = await send("PUT", `/projects/${project.id}/install-command`, {
      commandLine: "npm install",
    });

    expect(response.status).toBe(200);
    expect(projectSchema.parse(await response.json()).installCommand).toBe("npm install");
    expect(webEvents()).toEqual([
      { type: "project.install-command-changed", projectId: project.id },
    ]);
  });
});

describe("PUT /api/projects/:id/before-publishing-command and after-publishing-command", () => {
  it("sets each line, keeps it with the Project, clears it when blank, and announces each change", async () => {
    const project = await addProject();
    published = [];

    await send("PUT", `/projects/${project.id}/before-publishing-command`, {
      commandLine: "npx changeset version",
    });
    await send("PUT", `/projects/${project.id}/after-publishing-command`, {
      commandLine: "gh workflow run release.yml",
    });
    const cleared = await send("PUT", `/projects/${project.id}/before-publishing-command`, {
      commandLine: " ",
    });

    expect(cleared.status).toBe(200);
    const read = projectSchema.parse(
      await (await fetch(`${url}/api/projects/${project.id}`)).json(),
    );
    expect(read).toMatchObject({
      beforePublishingCommand: "",
      afterPublishingCommand: "gh workflow run release.yml",
    });
    expect(webEvents()).toEqual([
      { type: "project.before-publishing-command-changed", projectId: project.id },
      { type: "project.after-publishing-command-changed", projectId: project.id },
      { type: "project.before-publishing-command-changed", projectId: project.id },
    ]);
  });
});

describe("the Project's commands", () => {
  const E2E = { key: "test-e2e", name: "End to end", kind: "test", commandLine: "npm run e2e" };

  it("adds a command after the others and announces it", async () => {
    const project = await addProject();
    published = [];

    const response = await send("POST", `/projects/${project.id}/commands`, E2E);

    expect(response.status).toBe(201);
    expect(projectSchema.parse(await response.json()).commands).toEqual([...project.commands, E2E]);
    expect(webEvents()).toEqual([
      { type: "project.command-added", projectId: project.id, key: "test-e2e" },
    ]);
  });

  it("changes one command's name, kind and line, keeping its key, and announces it", async () => {
    const project = await addProject();
    published = [];

    const response = await send("PUT", `/projects/${project.id}/commands/test`, {
      name: "Unit tests",
      kind: "test",
      commandLine: "npm test -- --run",
    });

    expect(response.status).toBe(200);
    expect(projectSchema.parse(await response.json()).commands).toEqual(
      project.commands.map((command) =>
        command.key === "test"
          ? { key: "test", name: "Unit tests", kind: "test", commandLine: "npm test -- --run" }
          : command,
      ),
    );
    expect(webEvents()).toEqual([
      { type: "project.command-changed", projectId: project.id, key: "test" },
    ]);
  });

  it("removes a command and announces it", async () => {
    const project = await addProject();
    published = [];

    const response = await send("DELETE", `/projects/${project.id}/commands/lint`);

    expect(response.status).toBe(200);
    expect(projectSchema.parse(await response.json()).commands.map(({ key }) => key)).toEqual([
      "build",
      "test",
    ]);
    expect(webEvents()).toEqual([
      { type: "project.command-removed", projectId: project.id, key: "lint" },
    ]);
  });
});

describe("PUT /api/projects/:id/project-limit", () => {
  // At the contract's maximum, so the domain's own bound is no lower.
  it("changes how many of the Project's Tasks may be started at once and announces it", async () => {
    const project = await addProject();
    published = [];

    const response = await send("PUT", `/projects/${project.id}/project-limit`, {
      projectLimit: PROJECT_LIMIT_MAX,
    });

    expect(response.status).toBe(200);
    expect(projectSchema.parse(await response.json()).projectLimit).toBe(PROJECT_LIMIT_MAX);
    const read = await fetch(`${url}/api/projects/${project.id}`);
    expect(projectSchema.parse(await read.json()).projectLimit).toBe(PROJECT_LIMIT_MAX);
    expect(webEvents()).toEqual([{ type: "project.project-limit-changed", projectId: project.id }]);
  });
});

import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { projectRefusalSchema, projectSchema } from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { projectsHttp, startProjectsApplication } from "../../projects.controller.fixtures.js";
import {
  createTemporaryRepository,
  gitIn,
  type TemporaryRepository,
} from "../git/temporary-repository.fixtures.js";

let repository: TemporaryRepository;
let app: INestApplication;
let url: string;
let published: DomainEvent[];

beforeAll(async () => {
  repository = await createTemporaryRepository();
  // Its main tracks its origin's, a bare repository in a folder: no code host holds it.
  gitIn(repository.path, "fetch", "--quiet", "origin");
  gitIn(repository.path, "branch", "--quiet", "--set-upstream-to=origin/main", "main");
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

const { send, addProject, webEvents } = projectsHttp(() => ({ app, url, published, repository }));

describe("PUT /api/projects/:id/kind-default-pipeline", () => {
  it("gives a Kind a default Pipeline of its own, and back to the Project's", async () => {
    const project = await addProject();
    published = [];

    const bug = await send("PUT", `/projects/${project.id}/kind-default-pipeline`, {
      kind: "bug",
      pipelineId: "quick-fix",
    });
    expect(projectSchema.parse(await bug.json())).toMatchObject({
      kindDefaultPipelines: { feature: null, bug: "quick-fix", chore: null },
      defaultPipelineOfKind: { feature: "full", bug: "quick-fix", chore: "full" },
    });
    const back = await send("PUT", `/projects/${project.id}/kind-default-pipeline`, {
      kind: "bug",
      pipelineId: null,
    });

    expect(projectSchema.parse(await back.json()).defaultPipelineOfKind.bug).toBe("full");
    expect(webEvents()).toEqual([
      { type: "project.default-pipeline-changed", projectId: project.id },
      { type: "project.default-pipeline-changed", projectId: project.id },
    ]);
  });

  it("refuses a Pipeline that doesn't exist", async () => {
    const project = await addProject();

    const response = await send("PUT", `/projects/${project.id}/kind-default-pipeline`, {
      kind: "chore",
      pipelineId: "nightly",
    });

    expect(response.status).toBe(422);
  });
});

describe("PUT /api/projects/:id/issue-settings", () => {
  it("keeps the switches and the label", async () => {
    const project = await addProject();
    published = [];
    const settings = {
      autoImportLabel: "office",
      closeOnDone: false,
      commentOnStartAndDone: true,
      closeOnDrop: true,
    };

    const response = await send("PUT", `/projects/${project.id}/issue-settings`, settings);

    expect(projectSchema.parse(await response.json()).issueSettings).toEqual(settings);
    expect(webEvents()).toEqual([
      { type: "project.issue-settings-changed", projectId: project.id },
    ]);
  });
});

describe("GitHub issues of a Project", () => {
  it("shows the Project's code host from its remote's URL, which Import issues… offers", async () => {
    const project = await addProject();
    const onDisk = gitIn(repository.path, "remote", "get-url", "origin").trim();

    const listedOnDisk = projectSchema
      .array()
      .parse(await (await fetch(`${url}/api/projects`)).json())
      .find(({ id }) => id === project.id);
    gitIn(repository.path, "remote", "set-url", "origin", "https://github.com/acme/site.git");
    try {
      const onGitHub = projectSchema.parse(
        await (await fetch(`${url}/api/projects/${project.id}`)).json(),
      );

      expect(project.codeHost).toBeNull();
      expect(listedOnDisk?.codeHost).toBeNull();
      expect(onGitHub.codeHost).toBe("GitHub");
    } finally {
      gitIn(repository.path, "remote", "set-url", "origin", onDisk);
    }
  });

  it("are refused, saying why, for a repository that isn't on GitHub", async () => {
    const project = await addProject();

    const listed = await fetch(`${url}/api/projects/${project.id}/issues`);
    const imported = await send("POST", `/projects/${project.id}/issues/import`, {
      numbers: [1],
    });

    for (const response of [listed, imported]) {
      expect(response.status).toBe(422);
      expect(projectRefusalSchema.parse(await response.json()).reasons).toEqual([
        expect.stringMatching(/^GitHub issues need a repository on GitHub\. This Project's is at /),
      ]);
    }
  });

  it("answers null for a Task not imported from an issue", async () => {
    const response = await fetch(`${url}/api/issue-links?taskId=${randomUUID()}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
  });
});

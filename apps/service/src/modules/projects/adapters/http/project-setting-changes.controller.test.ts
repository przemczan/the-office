import type { INestApplication } from "@nestjs/common";
import {
  projectSettingChangesSchema,
  type Project,
  type ProjectSettingChange,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { SIGNED_IN_FOR_TESTS } from "../../../../platform/http/signed-in-requests.fixtures.js";
import { ProjectService } from "../../application/project-service.js";
import { projectsHttp, startProjectsApplication } from "../../projects.controller.fixtures.js";
import {
  createTemporaryRepository,
  REAL_GIT_TEST,
  type TemporaryRepository,
} from "../git/temporary-repository.fixtures.js";
import { aProjectCommandAction } from "./project-actions.controller.fixtures.js";

let repository: TemporaryRepository;
let app: INestApplication;
let url: string;
const published: DomainEvent[] = [];

beforeAll(async () => {
  repository = await createTemporaryRepository();
});

afterAll(async () => {
  await repository.remove();
});

beforeEach(async () => {
  ({ app, url } = await startProjectsApplication(repository));
});

afterEach(async () => {
  await app.close();
});

const { send, addProject } = projectsHttp(() => ({ app, url, published, repository }));

const BY_YOU = {
  kind: "user",
  user: { userId: SIGNED_IN_FOR_TESTS.userId, name: SIGNED_IN_FOR_TESTS.name },
} as const;

const SECRET_VALUE = "s3cret-token-value";

async function changesOf(project: Project): Promise<ProjectSettingChange[]> {
  const response = await fetch(`${url}/api/projects/${project.id}/setting-changes`);
  expect(response.status).toBe(200);
  return projectSettingChangesSchema.parse(await response.json()).changes;
}

function saved(response: Response): void {
  expect(response.status).toBeLessThan(300);
}

describe("GET /api/projects/:id/setting-changes", REAL_GIT_TEST, () => {
  it("records each save of a setting by the signed-in user, newest first", async () => {
    const project = await addProject();

    saved(await send("PUT", `/projects/${project.id}/install-command`, { commandLine: "npm i" }));
    saved(
      await send("POST", `/projects/${project.id}/commands`, {
        key: "e2e",
        name: "End to end",
        kind: "test",
        commandLine: "npm run e2e",
        rerunCommandLine: "",
      }),
    );
    saved(await send("DELETE", `/projects/${project.id}/commands/e2e`));
    saved(
      await send("PUT", `/projects/${project.id}/actions`, { actions: [aProjectCommandAction()] }),
    );

    expect(
      (await changesOf(project)).map(({ setting, summary, by }) => [setting, summary, by]),
    ).toEqual([
      ["actions", `added the Action ${aProjectCommandAction().name}`, BY_YOU],
      ["commands", "removed the command e2e", BY_YOU],
      ["commands", "added the command e2e", BY_YOU],
      ["commands", "changed Install", BY_YOU],
    ]);
  });

  it("names a Secret variable but never its value", async () => {
    const project = await addProject();

    saved(
      await send("PUT", `/projects/${project.id}/environment`, {
        environment: {
          set: [
            { name: "GREETING", value: "hello", secret: false },
            { name: "API_TOKEN", value: SECRET_VALUE, secret: true },
          ],
          unset: [],
          prependPath: [],
        },
      }),
    );

    const [change] = await changesOf(project);
    expect(change).toMatchObject({
      setting: "environment",
      summary: "set the Environment variables GREETING, API_TOKEN",
      by: BY_YOU,
    });
    expect(JSON.stringify(change)).not.toContain(SECRET_VALUE);
  });

  it("records nothing when a save changes nothing", async () => {
    const project = await addProject();

    saved(
      await send("PUT", `/projects/${project.id}/install-command`, {
        commandLine: project.installCommand,
      }),
    );

    expect(await changesOf(project)).toEqual([]);
  });

  it("records a person's change through their Office tools, with the Task it was made on", async () => {
    const project = await addProject();
    const byPerson = {
      kind: "person",
      roleKey: "devops",
      name: "Nina",
      title: "Devops",
      taskId: "task-1",
    } as const;

    await app.get(ProjectService).changeInstallInputs(project.id, [".nvmrc"], byPerson);

    expect(await changesOf(project)).toEqual([
      {
        id: expect.any(String),
        setting: "commands",
        summary: "changed Install inputs",
        by: byPerson,
        at: expect.any(String),
      },
    ]);
  });

  it("answers 404 for no such Project", async () => {
    const response = await fetch(`${url}/api/projects/no-such-project/setting-changes`);

    expect(response.status).toBe(404);
  });
});

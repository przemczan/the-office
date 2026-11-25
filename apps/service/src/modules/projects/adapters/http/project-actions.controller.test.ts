import type { INestApplication } from "@nestjs/common";
import { actionListSchema, projectRefusalSchema } from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "../../../../platform/events/event-bus.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { SIGNED_IN_FOR_TESTS } from "../../../../platform/http/signed-in-requests.fixtures.js";
import { projectsHttp, startProjectsApplication } from "../../projects.controller.fixtures.js";
import {
  createTemporaryRepository,
  REAL_GIT_TEST,
  type TemporaryRepository,
} from "../git/temporary-repository.fixtures.js";
import { aProjectCommandAction, aWorkflowAction } from "./project-actions.controller.fixtures.js";

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

const { send, addProject, webEvents } = projectsHttp(() => ({ app, url, published, repository }));

const BY_YOU = {
  by: "user",
  user: { userId: SIGNED_IN_FOR_TESTS.userId, name: SIGNED_IN_FOR_TESTS.name },
};

async function reasonsOf(response: Response): Promise<readonly string[]> {
  expect(response.status).toBe(422);
  return projectRefusalSchema.parse(await response.json()).reasons;
}

describe("PUT /api/projects/:id/actions", REAL_GIT_TEST, () => {
  it("saves the Actions set by you and tells the web, read back as saved", async () => {
    const project = await addProject();
    published.length = 0;

    const response = await send("PUT", `/projects/${project.id}/actions`, {
      actions: [aProjectCommandAction()],
    });

    expect(response.status).toBe(200);
    const { actions } = actionListSchema.parse(await response.json());
    expect(actions).toEqual([
      {
        ...aProjectCommandAction(),
        setBy: { name: BY_YOU, kind: BY_YOU, settings: BY_YOU, leavesTheWorkstation: BY_YOU },
      },
    ]);
    expect(webEvents()).toEqual([{ type: "project.actions-changed", projectId: project.id }]);
    const read = await fetch(`${url}/api/projects/${project.id}/actions`);
    expect(actionListSchema.parse(await read.json()).actions).toEqual(actions);
  });

  it("refuses what the Project doesn't have, naming it, saving nothing", async () => {
    const project = await addProject();
    published.length = 0;

    const reasons = await reasonsOf(
      await send("PUT", `/projects/${project.id}/actions`, {
        actions: [
          aProjectCommandAction({
            settings: {
              commandKey: "deploy",
              commandsBefore: [],
              timeLimitMinutes: null,
              projectDeviceId: null,
            },
          }),
          aProjectCommandAction({ name: "Again" }),
          {
            key: "phone",
            name: "Phone",
            kind: "test-target",
            settings: { targetKey: "android" },
            leavesTheWorkstation: false,
          },
        ],
      }),
    );

    expect(reasons).toEqual([
      "The key build-web is taken by another Action.",
      `Action "build-web": deploy isn't one of «${project.name}»'s commands.`,
      `Action "phone": android isn't one of «${project.name}»'s test targets.`,
    ]);
    const read = await fetch(`${url}/api/projects/${project.id}/actions`);
    expect(actionListSchema.parse(await read.json()).actions).toEqual([]);
    expect(webEvents()).toEqual([]);
  });

  it("refuses a Workflow it can't check on the base branch", async () => {
    const project = await addProject();

    const reasons = await reasonsOf(
      await send("PUT", `/projects/${project.id}/actions`, { actions: [aWorkflowAction()] }),
    );

    expect(reasons).toEqual([
      `Action "release": release.yml can't be checked on main: "${project.name}" has no Workflows to start: its base branch tracks no remote on a code host The Office knows.`,
    ]);
  });

  it("refuses every write while Actions are switched off", async () => {
    const project = await addProject();
    await send("PUT", `/projects/${project.id}/features`, { features: { actions: false } });

    const reasons = await reasonsOf(
      await send("PUT", `/projects/${project.id}/actions`, { actions: [aProjectCommandAction()] }),
    );

    expect(reasons).toEqual([`Actions are switched off for «${project.name}».`]);
  });
});

function environment(name: string) {
  return {
    environment: { set: [{ name, value: "x", secret: false }], unset: [], prependPath: [] },
  };
}

describe("the variables The Office sets in an Action's run", REAL_GIT_TEST, () => {
  it("can't be a Project variable's name while the Project has a Project command Action", async () => {
    const project = await addProject();
    await send("PUT", `/projects/${project.id}/actions`, { actions: [aProjectCommandAction()] });

    const reasons = await reasonsOf(
      await send("PUT", `/projects/${project.id}/environment`, environment("OFFICE_ACTION")),
    );

    expect(reasons).toEqual([
      "OFFICE_ACTION is a variable The Office sets in an Action's run, such as Build web's; give the Project variable another name.",
    ]);
  });

  it("refuse a Project command Action while a Project variable takes one", async () => {
    const project = await addProject();
    const saved = await send(
      "PUT",
      `/projects/${project.id}/environment`,
      environment("OFFICE_ACTION_BRANCH"),
    );
    expect(saved.status).toBe(200);

    const reasons = await reasonsOf(
      await send("PUT", `/projects/${project.id}/actions`, { actions: [aProjectCommandAction()] }),
    );

    expect(reasons).toEqual([
      `Action "build-web": OFFICE_ACTION_BRANCH is a variable The Office sets in an Action's run; rename the Project variable.`,
    ]);
  });
});
